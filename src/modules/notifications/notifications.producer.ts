import type { Prisma } from '@prisma/client';
import { getBoss, transactionalDb } from '../../shared/infra/queue/boss';
import { JOBS, type GenerateCertificatePayload, type SendEmailPayload } from '../../shared/infra/queue/jobs';

/**
 * Enfileira jobs DENTRO da transação que mudou o estado (padrão "transactional outbox"
 * sem tabela extra: a fila do pg-boss já é uma tabela do mesmo Postgres).
 * Commit → job visível para o worker. Rollback → job descartado junto.
 */
export const notificationsProducer = {
  async enqueueEmail(tx: Prisma.TransactionClient, payload: SendEmailPayload): Promise<void> {
    await getBoss().send(JOBS.SEND_EMAIL, payload, { db: transactionalDb(tx) });
  },

  async enqueueCertificate(tx: Prisma.TransactionClient, payload: GenerateCertificatePayload): Promise<void> {
    await getBoss().send(JOBS.GENERATE_CERTIFICATE, payload, { db: transactionalDb(tx) });
  },
};
