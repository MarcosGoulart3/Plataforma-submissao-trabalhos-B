import { prisma } from '../shared/infra/database/prisma';
import { startBoss, stopBoss } from '../shared/infra/queue/boss';
import { JOBS, type GenerateCertificatePayload, type SendEmailPayload } from '../shared/infra/queue/jobs';
import { logger } from '../shared/utils/logger';
import { handleCertificateJobs } from './certificate.worker';
import { handleEmailJobs } from './email.worker';

/**
 * Processo separado da API. Busca jobs no schema `pgboss` com
 * SELECT ... FOR UPDATE SKIP LOCKED: várias réplicas do worker podem rodar
 * em paralelo sem pegar o mesmo job.
 */
async function main() {
  const boss = await startBoss({ supervise: true });

  await boss.work<SendEmailPayload>(JOBS.SEND_EMAIL, { pollingIntervalSeconds: 2 }, handleEmailJobs);
  await boss.work<GenerateCertificatePayload>(
    JOBS.GENERATE_CERTIFICATE,
    { pollingIntervalSeconds: 2 },
    handleCertificateJobs,
  );

  logger.info('Worker iniciado: consumindo %s e %s', JOBS.SEND_EMAIL, JOBS.GENERATE_CERTIFICATE);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Encerrando worker (aguardando jobs em andamento)...');
    await stopBoss();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Falha ao iniciar o worker');
  process.exit(1);
});
