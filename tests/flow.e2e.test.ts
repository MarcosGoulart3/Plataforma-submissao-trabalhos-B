import request from 'supertest';
import { createApp } from '../src/app';
import { notificationsProducer } from '../src/modules/notifications/notifications.producer';
import { prisma } from '../src/shared/infra/database/prisma';
import { getBoss, startBoss, stopBoss } from '../src/shared/infra/queue/boss';
import { JOBS, type GenerateCertificatePayload, type SendEmailPayload } from '../src/shared/infra/queue/jobs';
import { viaCep } from '../src/shared/infra/viacep';
import { handleCertificateJobs } from '../src/workers/certificate.worker';
import { handleEmailJobs } from '../src/workers/email.worker';
import { createUser, DAY, fakePdf, queuedJobs, resetDatabase, timeline } from './helpers';

const app = createApp();

type TestUser = Awaited<ReturnType<typeof createUser>>;
let organizer: TestUser;
let otherOrganizer: TestUser;
let reviewer1: TestUser;
let reviewer2: TestUser; // será coautor → conflito de interesse
let reviewer3: TestUser;
let authorToken: string;
let authorId: string;
let eventId: string;
let goodSubmissionId: string;
let weakSubmissionId: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function submit(token: string, fields: Record<string, string>, file = fakePdf(), filename = 'resumo.pdf') {
  let req = request(app).post(`/events/${eventId}/submissions`).set(auth(token));
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  return req.attach('file', file, { filename, contentType: filename.endsWith('.pdf') ? 'application/pdf' : 'text/plain' });
}

async function setEventPhase(phase: Parameters<typeof timeline>[0]) {
  await prisma.event.update({ where: { id: eventId }, data: timeline(phase) });
}

beforeAll(async () => {
  await resetDatabase();
  await startBoss({ supervise: false });

  organizer = await createUser('Olga Organizadora', 'olga@furg.br', ['ORGANIZER']);
  otherOrganizer = await createUser('Oscar Organizador', 'oscar@furg.br', ['ORGANIZER']);
  reviewer1 = await createUser('Rui Revisor', 'rui@furg.br', ['REVIEWER']);
  reviewer2 = await createUser('Rita Revisora', 'rita@furg.br', ['REVIEWER']);
  reviewer3 = await createUser('Raul Revisor', 'raul@furg.br', ['REVIEWER']);
});

afterAll(async () => {
  await stopBoss();
  await prisma.$disconnect();
});

describe('fluxo completo do evento', () => {
  it('cadastro e login do autor', async () => {
    const register = await request(app)
      .post('/auth/register')
      .send({ name: 'Ana Autora', email: 'ANA@furg.br', password: 'senha12345' });
    expect(register.status).toBe(201);
    expect(register.body.user.roles).toEqual(['PARTICIPANT']);

    const duplicated = await request(app)
      .post('/auth/register')
      .send({ name: 'Ana Autora', email: 'ana@furg.br', password: 'senha12345' });
    expect(duplicated.status).toBe(409);

    const login = await request(app).post('/auth/login').send({ email: 'ana@furg.br', password: 'senha12345' });
    expect(login.status).toBe(200);
    authorToken = login.body.accessToken;
    authorId = login.body.user.id;

    const me = await request(app).get('/auth/me').set(auth(authorToken));
    expect(me.body.email).toBe('ana@furg.br');
    expect((await request(app).get('/auth/me')).status).toBe(401);
  });

  it('endereço preenchido pelo CEP', async () => {
    vi.spyOn(viaCep, 'lookup').mockResolvedValueOnce({
      cep: '96201460',
      street: 'Rua Eng. Alfredo Huch',
      neighborhood: 'Centro',
      city: 'Rio Grande',
      state: 'RS',
    });
    const res = await request(app)
      .put('/users/me/address')
      .set(auth(authorToken))
      .send({ cep: '96201-460', number: '475' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cep: '96201460', city: 'Rio Grande', state: 'RS', number: '475' });
  });

  it('somente organizador cria evento', async () => {
    const body = { name: 'MEPERG 2026', areas: ['Computação', 'Educação'], approvalThreshold: 6, ...timeline('submission') };

    expect((await request(app).post('/events').set(auth(authorToken)).send(body)).status).toBe(403);

    const res = await request(app).post('/events').set(auth(organizer.token)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.deadlines.submission.open).toBe(true);
    eventId = res.body.id;

    const notOwner = await request(app).patch(`/events/${eventId}`).set(auth(otherOrganizer.token)).send({ name: 'Evento sequestrado' });
    expect(notOwner.status).toBe(403);
  });

  it('autor submete trabalhos e o job de e-mail é gravado junto', async () => {
    const good = await submit(authorToken, {
      title: 'Robótica educacional no ensino médio',
      area: 'Computação',
      coauthors: JSON.stringify([{ name: 'Rita Revisora', email: 'rita@furg.br' }]),
    });
    expect(good.status).toBe(201);
    expect(good.body.status).toBe('SUBMITTED');
    goodSubmissionId = good.body.id;

    const weak = await submit(authorToken, { title: 'Um estudo preliminar', area: 'Educação' });
    expect(weak.status).toBe(201);
    weakSubmissionId = weak.body.id;

    // um e-mail por destinatário: a coautora não vê o endereço da autora (e vice-versa)
    const emails = await queuedJobs(JOBS.SEND_EMAIL);
    expect(emails).toHaveLength(3);
    // jobs da mesma transação têm o mesmo created_on: a ordem entre eles não é garantida
    expect(emails.map((j) => j.data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ template: 'submission-received', to: 'ana@furg.br', data: expect.objectContaining({ recipientName: 'Ana Autora' }) }),
        expect.objectContaining({ template: 'submission-received', to: 'rita@furg.br', data: expect.objectContaining({ recipientName: 'Rita Revisora' }) }),
      ]),
    );
  });

  it('valida o upload: só PDF e com tamanho máximo', async () => {
    const fields = { title: 'Trabalho inválido', area: 'Computação' };

    const txt = await submit(authorToken, fields, Buffer.from('texto'), 'resumo.txt');
    expect(txt.status).toBe(400);

    const fakeExtension = await submit(authorToken, fields, Buffer.from('MZ executável'), 'resumo.pdf');
    expect(fakeExtension.status).toBe(400);
    expect(fakeExtension.body.error.message).toMatch(/não é um PDF/);

    const tooBig = await submit(authorToken, fields, fakePdf(1024 * 1024 + 1));
    expect(tooBig.status).toBe(413);

    const missing = await request(app)
      .post(`/events/${eventId}/submissions`)
      .set(auth(authorToken))
      .field('title', 'Sem arquivo')
      .field('area', 'Computação');
    expect(missing.status).toBe(400);

    const wrongArea = await submit(authorToken, { title: 'Área inexistente', area: 'Medicina' });
    expect(wrongArea.status).toBe(422);
  });

  it('só o autor edita, e só dentro do prazo', async () => {
    const edit = await request(app)
      .patch(`/submissions/${goodSubmissionId}`)
      .set(auth(authorToken))
      .field('title', 'Robótica educacional no ensino médio público');
    expect(edit.status).toBe(200);
    expect(edit.body.title).toBe('Robótica educacional no ensino médio público');

    const intruder = await request(app)
      .patch(`/submissions/${goodSubmissionId}`)
      .set(auth(reviewer1.token))
      .field('title', 'Hackeado');
    expect(intruder.status).toBe(403);

    await setEventPhase('review');

    const late = await request(app)
      .patch(`/submissions/${goodSubmissionId}`)
      .set(auth(authorToken))
      .field('title', 'Edição atrasada');
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('SUBMISSION_PERIOD_CLOSED');

    const lateSubmission = await submit(authorToken, { title: 'Submissão atrasada', area: 'Computação' });
    expect(lateSubmission.status).toBe(422);
  });

  it('atribuição de avaliadores bloqueia conflito de interesse', async () => {
    const conflict = await request(app)
      .post(`/submissions/${goodSubmissionId}/reviewers`)
      .set(auth(organizer.token))
      .send({ reviewerIds: [reviewer2.id] });
    expect(conflict.status).toBe(422);
    expect(conflict.body.error.code).toBe('CONFLICT_OF_INTEREST');

    const notReviewer = await request(app)
      .post(`/submissions/${goodSubmissionId}/reviewers`)
      .set(auth(organizer.token))
      .send({ reviewerIds: [authorId] });
    expect(notReviewer.status).toBe(422);

    const ok = await request(app)
      .post(`/submissions/${goodSubmissionId}/reviewers`)
      .set(auth(organizer.token))
      .send({ reviewerIds: [reviewer1.id, reviewer3.id] });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('UNDER_REVIEW');

    const duplicated = await request(app)
      .post(`/submissions/${goodSubmissionId}/reviewers`)
      .set(auth(organizer.token))
      .send({ reviewerIds: [reviewer1.id] });
    expect(duplicated.status).toBe(409);
    expect(duplicated.body.error.message).toBe('Avaliador já atribuído a este trabalho');
    expect(await prisma.review.count({ where: { submissionId: goodSubmissionId, reviewerId: reviewer1.id } })).toBe(1);

    const weak = await request(app)
      .post(`/submissions/${weakSubmissionId}/reviewers`)
      .set(auth(organizer.token))
      .send({ reviewerIds: [reviewer2.id] });
    expect(weak.status).toBe(200);

    const templates = (await queuedJobs(JOBS.SEND_EMAIL)).map((j) => j.data.template);
    expect(templates.filter((t) => t === 'reviewer-assigned')).toHaveLength(3);
    // trabalho bom: autora + coautora; trabalho fraco: só a autora
    expect(templates.filter((t) => t === 'submission-status-changed')).toHaveLength(3);
  });

  it('avaliador vê o trabalho às cegas e registra nota e parecer', async () => {
    const assigned = await request(app).get('/reviews/assigned').set(auth(reviewer1.token));
    expect(assigned.status).toBe(200);
    expect(assigned.body).toHaveLength(1);
    expect(assigned.body[0].submission).not.toHaveProperty('author');

    const detail = await request(app).get(`/submissions/${goodSubmissionId}`).set(auth(reviewer1.token));
    expect(detail.body).not.toHaveProperty('author');
    expect(detail.body).not.toHaveProperty('coauthors');

    const file = await request(app).get(`/submissions/${goodSubmissionId}/file`).set(auth(reviewer1.token));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');

    // organizador de OUTRO evento não tem acesso
    const stranger = await request(app).get(`/submissions/${goodSubmissionId}`).set(auth(otherOrganizer.token));
    expect(stranger.status).toBe(403);

    const reviewIdOf = async (user: TestUser, submissionId: string) =>
      (await prisma.review.findFirstOrThrow({ where: { reviewerId: user.id, submissionId } })).id;

    const r1 = await request(app)
      .put(`/reviews/${await reviewIdOf(reviewer1, goodSubmissionId)}`)
      .set(auth(reviewer1.token))
      .send({ grade: 8, comments: 'Metodologia clara e bons resultados.' });
    expect(r1.status).toBe(200);

    // 1 de 2 avaliações: nada de nota final, só a média parcial rotulada
    const partial = await request(app).get(`/submissions/${goodSubmissionId}`).set(auth(organizer.token));
    expect(partial.body.finalGrade).toBeNull();
    expect(partial.body.reviewProgress).toEqual({ completed: 1, assigned: 2, partialGrade: 8 });

    const wrongReviewer = await request(app)
      .put(`/reviews/${await reviewIdOf(reviewer1, goodSubmissionId)}`)
      .set(auth(reviewer3.token))
      .send({ grade: 1, comments: 'Tentando avaliar no lugar de outro.' });
    expect(wrongReviewer.status).toBe(403);

    await request(app)
      .put(`/reviews/${await reviewIdOf(reviewer3, goodSubmissionId)}`)
      .set(auth(reviewer3.token))
      .send({ grade: 9.5, comments: 'Excelente contribuição para a área.' })
      .expect(200);

    await request(app)
      .put(`/reviews/${await reviewIdOf(reviewer2, weakSubmissionId)}`)
      .set(auth(reviewer2.token))
      .send({ grade: 4, comments: 'Faltam resultados e referências.' })
      .expect(200);

    const submission = await prisma.submission.findUniqueOrThrow({ where: { id: goodSubmissionId } });
    expect(Number(submission.finalGrade)).toBe(8.75);

    // autor ainda não vê notas antes da publicação
    const authorView = await request(app).get(`/submissions/${goodSubmissionId}`).set(auth(authorToken));
    expect(authorView.body.finalGrade).toBeNull();
    expect(authorView.body.reviews).toEqual([]);
  });

  it('publica o resultado só após o prazo de avaliação, enfileirando e-mails e certificado', async () => {
    const early = await request(app).post(`/events/${eventId}/results/publish`).set(auth(organizer.token)).send({});
    expect(early.status).toBe(422);

    await setEventPhase('finished');

    const res = await request(app).post(`/events/${eventId}/results/publish`).set(auth(organizer.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, approved: 1, rejected: 1 });

    const again = await request(app).post(`/events/${eventId}/results/publish`).set(auth(organizer.token)).send({});
    expect(again.status).toBe(422);

    const resultEmails = (await queuedJobs(JOBS.SEND_EMAIL)).filter(
      (j) => j.data.template === 'submission-status-changed' && (j.data.data as { status: string }).status === 'APPROVED',
    );
    expect(resultEmails.map((j) => j.data.to).sort()).toEqual(['ana@furg.br', 'rita@furg.br']);

    const certificateJobs = await queuedJobs(JOBS.GENERATE_CERTIFICATE);
    expect(certificateJobs).toEqual([{ name: JOBS.GENERATE_CERTIFICATE, data: { submissionId: goodSubmissionId } }]);

    const authorView = await request(app).get(`/submissions/${goodSubmissionId}`).set(auth(authorToken));
    expect(authorView.body.status).toBe('APPROVED');
    expect(authorView.body.finalGrade).toBe(8.75);
    expect(authorView.body.reviews).toHaveLength(2);
    expect(authorView.body.reviews[0]).not.toHaveProperty('reviewer');
  });

  it('worker processa os jobs: emite o certificado e envia os e-mails', async () => {
    const boss = getBoss();

    const certJobs = await boss.fetch<GenerateCertificatePayload>(JOBS.GENERATE_CERTIFICATE, { batchSize: 10 });
    expect(certJobs).toHaveLength(1);
    await handleCertificateJobs(certJobs);
    // reprocessar (retry/entrega duplicada) não gera certificado duplicado
    await handleCertificateJobs(certJobs);
    expect(await prisma.certificate.count()).toBe(1);

    const mine = await request(app).get('/certificates/mine').set(auth(authorToken));
    expect(mine.body).toHaveLength(1);
    const { id, verificationCode } = mine.body[0];

    const pdf = await request(app)
      .get(`/certificates/${id}/download`)
      .set(auth(authorToken))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    expect((await request(app).get(`/certificates/${id}/download`).set(auth(reviewer1.token))).status).toBe(403);

    const verify = await request(app).get(`/certificates/verify/${verificationCode}`);
    expect(verify.body).toMatchObject({ valid: true, authors: ['Ana Autora', 'Rita Revisora'] });

    const emailJobs = await boss.fetch<SendEmailPayload>(JOBS.SEND_EMAIL, { batchSize: 50 });
    expect(emailJobs.map((j) => j.data.template)).toContain('certificate-issued');
    await expect(handleEmailJobs(emailJobs)).resolves.toBeUndefined();
  });

  it('painel do organizador com estatísticas', async () => {
    const res = await request(app).get(`/events/${eventId}/dashboard`).set(auth(organizer.token));
    expect(res.status).toBe(200);
    expect(res.body.submissions).toMatchObject({ total: 2, byStatus: { APPROVED: 1, REJECTED: 1 } });
    expect(res.body.approvalRate).toBe(0.5);
    expect(res.body.byArea).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ area: 'Computação', submissions: 1, approved: 1, approvalRate: 1 }),
        expect.objectContaining({ area: 'Educação', submissions: 1, rejected: 1, approvalRate: 0 }),
      ]),
    );
    expect(res.body.reviews).toMatchObject({ assigned: 3, completed: 3, pending: 0 });

    expect((await request(app).get(`/events/${eventId}/dashboard`).set(auth(otherOrganizer.token))).status).toBe(403);
  });
});

describe('atomicidade: job e mudança de estado na mesma transação', () => {
  it('rollback da transação descarta o job enfileirado', async () => {
    const before = (await queuedJobs()).length;

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.event.update({ where: { id: eventId }, data: { name: 'Nome que não deve persistir' } });
        await notificationsProducer.enqueueCertificate(tx, { submissionId: goodSubmissionId });
        throw new Error('falha simulada após enfileirar');
      }),
    ).rejects.toThrow('falha simulada');

    expect((await queuedJobs()).length).toBe(before);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.name).toBe('MEPERG 2026');
  });

  it('commit torna o job visível', async () => {
    const before = (await queuedJobs(JOBS.GENERATE_CERTIFICATE)).length;
    await prisma.$transaction((tx) => notificationsProducer.enqueueCertificate(tx, { submissionId: goodSubmissionId }));
    expect((await queuedJobs(JOBS.GENERATE_CERTIFICATE)).length).toBe(before + 1);
  });
});

describe('sessão e bloqueio de login', () => {
  it('logout invalida o token, mas não as outras sessões', async () => {
    const login = () => request(app).post('/auth/login').send({ email: 'ana@furg.br', password: 'senha12345' });
    const session = (await login()).body.accessToken;
    const other = (await login()).body.accessToken;

    expect((await request(app).post('/auth/logout').set(auth(session))).status).toBe(204);
    const me = await request(app).get('/auth/me').set(auth(session));
    expect(me.status).toBe(401);
    expect((await request(app).get('/auth/me').set(auth(other))).status).toBe(200);
  });

  it('bloqueia após 5 falhas, inclusive com a senha correta', async () => {
    await createUser('Lia Lima', 'lia@furg.br', ['PARTICIPANT']);
    const tryLogin = (password: string) => request(app).post('/auth/login').send({ email: 'lia@furg.br', password });

    for (let i = 0; i < 5; i++) expect((await tryLogin('errada123')).status).toBe(401);

    const blocked = await tryLogin('senha12345');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toBe('Muitas tentativas. Tente novamente mais tarde.');

    // bloqueio vencido: a senha correta volta a funcionar e zera a contagem
    await prisma.loginAttempt.update({ where: { email: 'lia@furg.br' }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await tryLogin('senha12345')).status).toBe(200);
    expect(await prisma.loginAttempt.count({ where: { email: 'lia@furg.br' } })).toBe(0);
  });

  it('e-mail inexistente também é bloqueado (não revela quais e-mails existem)', async () => {
    const tryLogin = () => request(app).post('/auth/login').send({ email: 'ninguem@furg.br', password: 'errada123' });
    for (let i = 0; i < 5; i++) expect((await tryLogin()).status).toBe(401);
    expect((await tryLogin()).status).toBe(429);
  });
});

describe('regras de publicação do resultado', () => {
  let pubEventId: string;
  let pubSubmissionId: string;

  beforeAll(async () => {
    const now = Date.now();
    const at = (days: number) => new Date(now + days * DAY);
    const event = await prisma.event.create({
      data: {
        name: 'Evento de publicação',
        areas: ['Computação'],
        organizerId: organizer.id,
        submissionStartsAt: at(-30),
        submissionEndsAt: at(-20),
        reviewStartsAt: at(-20),
        reviewEndsAt: at(-1),
        resultAt: at(1), // avaliação encerrada, mas o resultado só sai amanhã
      },
    });
    pubEventId = event.id;
    const submission = await prisma.submission.create({
      data: {
        eventId: event.id,
        authorId,
        title: 'Trabalho da publicação',
        area: 'Computação',
        status: 'UNDER_REVIEW',
        fileKey: 'submissions/fake.pdf',
        fileName: 'fake.pdf',
        fileSize: 10,
      },
    });
    pubSubmissionId = submission.id;
    await prisma.review.create({
      data: { submissionId: submission.id, reviewerId: reviewer1.id, grade: 9, comments: 'Ótimo.', submittedAt: new Date() },
    });
  });

  const publish = () => request(app).post(`/events/${pubEventId}/results/publish`).set(auth(organizer.token)).send({});

  it('não publica antes da data de resultado', async () => {
    const res = await publish();
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/^O resultado só pode ser publicado a partir de /);
  });

  it('não publica com avaliação pendente e não altera nenhum status', async () => {
    await prisma.event.update({ where: { id: pubEventId }, data: { resultAt: new Date(Date.now() - 60_000) } });
    await prisma.review.create({ data: { submissionId: pubSubmissionId, reviewerId: reviewer3.id } });

    const res = await publish();
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Há submissões com avaliações pendentes');
    expect(res.body.error.details.submissions).toEqual([
      { id: pubSubmissionId, title: 'Trabalho da publicação', completed: 1, assigned: 2 },
    ]);
    const submission = await prisma.submission.findUniqueOrThrow({ where: { id: pubSubmissionId } });
    expect(submission.status).toBe('UNDER_REVIEW');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: pubEventId } })).resultsPublishedAt).toBeNull();
  });

  it('removida a pendência, publica com a média completa', async () => {
    const unassign = await request(app)
      .delete(`/submissions/${pubSubmissionId}/reviewers/${reviewer3.id}`)
      .set(auth(organizer.token));
    expect(unassign.status).toBe(204);

    const res = await publish();
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([expect.objectContaining({ finalGrade: 9, status: 'APPROVED' })]);
  });
});

describe('exclusão de evento', () => {
  it('só o organizador dono exclui, e só evento sem submissões', async () => {
    expect((await request(app).delete(`/events/${eventId}`).set(auth(authorToken))).status).toBe(403);
    expect((await request(app).delete(`/events/${eventId}`).set(auth(otherOrganizer.token))).status).toBe(403);

    const withSubmissions = await request(app).delete(`/events/${eventId}`).set(auth(organizer.token));
    expect(withSubmissions.status).toBe(409);

    const body = { name: 'Evento vazio', areas: ['Computação'], ...timeline('submission') };
    const empty = await request(app).post('/events').set(auth(organizer.token)).send(body);
    expect((await request(app).delete(`/events/${empty.body.id}`).set(auth(organizer.token))).status).toBe(204);
    expect((await request(app).get(`/events/${empty.body.id}`).set(auth(organizer.token))).status).toBe(404);
  });
});
