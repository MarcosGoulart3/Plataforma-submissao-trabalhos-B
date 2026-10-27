# Grande — Plataforma de submissão e avaliação de trabalhos

API para eventos acadêmicos no estilo da MEPERG: autores submetem resumos em PDF, avaliadores dão nota e parecer, organizadores gerenciam prazos e publicam resultados, e certificados são emitidos automaticamente.

**Stack:** Node.js 22 · TypeScript · Express 5 · Prisma 6 · PostgreSQL · pg-boss 10 (fila) · Zod 4 · pdfkit · Nodemailer · S3/MinIO · Vitest

## Arquitetura

```
API (Express) ──┐  INSERT do job na MESMA transação da mudança de status
                ├──▶ PostgreSQL ◀── Worker (e-mail, PDF do certificado)
                │    tabelas da aplicação + schema "pgboss"   busca jobs com SKIP LOCKED
                └──▶ Storage (disco local ou MinIO/S3) ◀── Worker
```

Dois processos com a mesma base de código:

| Processo | Entrypoint | Responsabilidade |
|---|---|---|
| API | `src/server.ts` | HTTP, regras de negócio, **produz** jobs |
| Worker | `src/workers/index.ts` | **consome** jobs: envia e-mails e gera certificados |

### Decisões principais

- **Fila no próprio Postgres (pg-boss) + job na mesma transação.** O `notifications.producer` passa ao pg-boss um adaptador (`transactionalDb`) que executa o `INSERT` do job pela conexão da transação interativa do Prisma. Se a transação faz rollback, o job some junto; se faz commit, o worker o enxerga. Isso dispensa uma tabela de outbox e evita os dois problemas clássicos: e-mail de uma mudança que não aconteceu e mudança sem o e-mail. O teste `tests/flow.e2e.test.ts` comprova os dois casos.
- **Worker separado, com retry e dead letter.** As filas têm `retryLimit: 5` com backoff exponencial. Esgotadas as tentativas, o job vai para `jobs.dead-letter`. Como o pg-boss usa `SKIP LOCKED`, várias réplicas do worker podem rodar em paralelo.
- **Idempotência no worker.** A emissão de certificado confere se já existe um (`submissionId` é único), usa uma chave de storage determinística e trata a corrida (`P2002`). Reprocessar um job não duplica o certificado nem o e-mail.
- **Camadas por módulo:** `routes → controller (valida com Zod) → service (regras) → repository (Prisma)`. Os repositórios aceitam um `DbClient` opcional para participar de transações.
- **Autorização em dois níveis.** O middleware `authorize(...papéis)` faz o controle por papel. As *policies* fazem o controle por recurso: `event.policy` diz se o usuário é o organizador dono do evento, `submission.policy` diz se é o autor e se está dentro do prazo, e `conflict-of-interest` impede o avaliador de avaliar o próprio trabalho ou um de que é coautor. O usuário é recarregado do banco a cada requisição, então uma mudança de papel vale na hora.
- **Regras puras e testáveis.** `deadline.policy`, `final-grade`, `conflict-of-interest` e `metrics` não dependem de I/O.
- **ViaCEP tolerante a falhas:** timeout via `AbortSignal`, retry com backoff só em erro de rede ou 5xx, e cache em memória com TTL. Se a API estiver fora ou não conhecer o CEP (ex.: CEP novo), o endereço ainda é aceito quando o usuário preenche todos os campos manualmente (degradação graciosa); caso contrário a resposta é 503 (ViaCEP fora) ou 404 `CEP_NOT_FOUND` (CEP desconhecido) com a lista do que falta.
- **Upload seguro.** O `multer` guarda o arquivo em memória e verifica o limite de tamanho, o mimetype e a extensão. Em seguida o código confere a assinatura `%PDF-`, porque o mimetype é informado pelo cliente. O arquivo é gravado antes da transação e removido se ela falhar (compensação).
- **Avaliação cega.** O avaliador não vê autor, coautores nem o nome original do arquivo. O autor só vê a nota e os pareceres, de forma anônima, depois da publicação do resultado.

## Como rodar

### Tudo com Docker

```bash
docker compose up --build
```

- API: http://localhost:3333
- MailHog (e-mails enviados): http://localhost:8025
- MinIO console: http://localhost:9001 (minioadmin / minioadmin)

Para popular com usuários e um evento de exemplo:

```bash
docker compose exec api node dist/shared/infra/database/seed.js
```

### Desenvolvimento local

```bash
npm install
cp .env.example .env          # ajuste DATABASE_URL
docker compose up -d postgres mailhog minio   # ou use um Postgres próprio
npx prisma migrate deploy
npm run db:seed
npm run dev                   # API
npm run dev:worker            # worker (outro terminal)
```

Usuários do seed (senha `senha12345`): `admin@`, `organizador@`, `avaliador1@`, `avaliador2@` e `autora@grande.local`.

### Testes

```bash
npm test                      # unitários (sem banco)
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/grande_test npm run test:integration
```

O teste de integração **apaga os dados** do banco indicado. Use sempre um banco descartável.

## Endpoints

Autenticação via `Authorization: Bearer <token>`. Erros seguem o formato `{ "error": { "code", "message", "details?" } }`.

| Método | Rota | Quem | Descrição |
|---|---|---|---|
| POST | `/auth/register` | público | Cadastro (sempre como PARTICIPANT) |
| POST | `/auth/login` | público | Retorna `accessToken`; após 5 falhas em 15 min o e-mail fica bloqueado por 15 min (429) |
| POST | `/auth/logout` | logado | Revoga o token atual (204) |
| GET | `/auth/me` | logado | Usuário atual |
| GET/PATCH | `/users/me` | logado | Perfil |
| PUT | `/users/me/address` | logado | Endereço com autopreenchimento pelo CEP |
| GET | `/users/cep/:cep` | logado | Consulta o ViaCEP (para o formulário) |
| GET | `/users?role=REVIEWER` | organizador | Lista usuários |
| PATCH | `/users/:id/roles` | admin | Define papéis |
| GET | `/events`, `/events/:id` | logado | Eventos e situação dos prazos |
| POST | `/events` | organizador | Cria evento com prazos |
| PATCH | `/events/:id` | organizador dono | Edita evento |
| DELETE | `/events/:id` | organizador dono | Exclui evento sem submissões (409 se houver) |
| POST | `/events/:eventId/submissions` | logado | Submete (multipart: `file`, `title`, `area`, `abstract`, `coauthors` em JSON) |
| GET | `/events/:eventId/submissions` | organizador dono | Lista trabalhos (`?status=&area=`) |
| GET | `/submissions/mine` | logado | Trabalhos em que sou autor ou coautor |
| GET | `/submissions/:id` | autor, avaliador, organizador | Detalhe (visão depende de quem pede) |
| PATCH | `/submissions/:id` | autor | Edita no prazo (multipart; `file` opcional) |
| GET | `/submissions/:id/file` | autor, avaliador, organizador | Baixa o PDF |
| POST | `/submissions/:id/reviewers` | organizador dono | Atribui avaliadores `{ reviewerIds }` (409 se algum já estiver atribuído) |
| DELETE | `/submissions/:id/reviewers/:reviewerId` | organizador dono | Remove atribuição pendente |
| GET | `/reviews/assigned` | avaliador | Meus trabalhos para avaliar |
| PUT | `/reviews/:id` | avaliador atribuído | Nota (0–10) e parecer |
| POST | `/events/:eventId/results/publish` | organizador dono | Publica o resultado a partir de `resultAt`, sem avaliações pendentes `{ rejectUnreviewed? }` |
| GET | `/events/:eventId/dashboard` | organizador dono | Estatísticas |
| GET | `/certificates/mine` | logado | Meus certificados |
| GET | `/certificates/:id/download` | autor, coautor, organizador | PDF do certificado |
| GET | `/certificates/verify/:code` | público | Valida a autenticidade |

### Ciclo de vida da submissão

```
SUBMITTED ──(1º avaliador atribuído)──▶ UNDER_REVIEW ──(publicação)──▶ APPROVED ─▶ certificado
                                                                    └▶ REJECTED
```

Cada transição enfileira um e-mail **por destinatário** (autor e cada coautor), para que ninguém veja o endereço dos demais. A aprovação também enfileira a geração do certificado. A nota final é a média das avaliações e só existe quando **todas** as avaliações atribuídas foram concluídas; antes disso, o organizador vê `finalGrade: null` e a média parcial em `reviewProgress`. O trabalho é aprovado se a nota final for maior ou igual ao `approvalThreshold` do evento (6 por padrão).

A publicação exige que a data de resultado (`resultAt`) tenha chegado e que nenhum trabalho tenha avaliação pendente. Uma pendência se resolve aguardando a avaliação, prorrogando o período de avaliação ou removendo a atribuição. `rejectUnreviewed` reprova apenas os trabalhos sem nenhum avaliador.

## Estrutura

```
src/
├── modules/           auth, users, events, submissions, reviews, certificates, notifications, reports
├── shared/
│   ├── http/          errors, middlewares (authenticate, authorize, upload, errorHandler)
│   ├── infra/         database (prisma, seed), queue (pg-boss), storage, mail, viacep
│   ├── config/env.ts  variáveis validadas com Zod (o processo não sobe se forem inválidas)
│   └── utils/
├── workers/           index.ts (entrypoint), email.worker.ts, certificate.worker.ts
├── app.ts / server.ts
prisma/                schema + migrations
tests/                 integração ponta a ponta
```
