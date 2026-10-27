import PgBoss from 'pg-boss';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { JOBS } from './jobs';

/**
 * pg-boss usa a MESMA DATABASE_URL da aplicação: a fila vive no schema `pgboss`
 * do mesmo Postgres. Isso permite gravar o job na mesma transação da mudança de status.
 */
function connectionString(): string {
  // o parâmetro `schema` é do Prisma; o driver `pg` não o entende
  const url = new URL(env.DATABASE_URL);
  url.searchParams.delete('schema');
  return url.toString();
}

let instance: PgBoss | null = null;

export function getBoss(): PgBoss {
  if (!instance) {
    throw new Error('pg-boss não foi iniciado: chame startBoss() no entrypoint do processo');
  }
  return instance;
}

/**
 * Inicia o pg-boss (cria/migra o schema `pgboss` se necessário) e garante as filas.
 * Só o worker supervisiona (manutenção, expiração, arquivamento); a API apenas produz jobs.
 */
export async function startBoss(options: { supervise: boolean }): Promise<PgBoss> {
  if (instance) return instance;

  const boss = new PgBoss({
    connectionString: connectionString(),
    schema: env.PGBOSS_SCHEMA,
    supervise: options.supervise,
    schedule: options.supervise,
  });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();
  await ensureQueues(boss);

  instance = boss;
  return boss;
}

export async function stopBoss(): Promise<void> {
  if (instance) {
    const boss = instance;
    instance = null;
    await boss.stop({ graceful: true, wait: true });
  }
}

async function ensureQueue(boss: PgBoss, queue: PgBoss.Queue) {
  const existing = await boss.getQueue(queue.name);
  if (!existing) {
    await boss.createQueue(queue.name, queue);
  }
}

async function ensureQueues(boss: PgBoss) {
  await ensureQueue(boss, { name: JOBS.DEAD_LETTER });
  // retry com backoff exponencial; esgotadas as tentativas, o job vai para a dead letter
  const retryPolicy = { retryLimit: 5, retryDelay: 30, retryBackoff: true, deadLetter: JOBS.DEAD_LETTER };
  await ensureQueue(boss, { name: JOBS.SEND_EMAIL, ...retryPolicy });
  await ensureQueue(boss, { name: JOBS.GENERATE_CERTIFICATE, ...retryPolicy });
}

/**
 * Adaptador que faz o pg-boss executar o INSERT do job usando a conexão
 * da transação interativa do Prisma. Se a transação sofrer rollback, o job some junto.
 */
export function transactionalDb(tx: Prisma.TransactionClient): PgBoss.Db {
  return {
    async executeSql(text: string, values: unknown[] = []) {
      const params = values.map((value) => {
        if (value === undefined) return null;
        if (value !== null && typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
        return value;
      });
      const rows = await tx.$queryRawUnsafe<unknown[]>(text, ...params);
      return { rows };
    },
  };
}
