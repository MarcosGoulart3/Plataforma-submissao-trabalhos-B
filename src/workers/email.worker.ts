import type { Job } from 'pg-boss';
import { renderEmail } from '../modules/notifications/templates';
import { mailer } from '../shared/infra/mail';
import type { SendEmailPayload } from '../shared/infra/queue/jobs';
import { logger } from '../shared/utils/logger';

/** Se lançar erro, o pg-boss reagenda o job (retry com backoff) */
export async function handleEmailJobs(jobs: Job<SendEmailPayload>[]): Promise<void> {
  for (const job of jobs) {
    const email = renderEmail(job.data);
    await mailer.send({ to: job.data.to, ...email });
    logger.info({ jobId: job.id, template: job.data.template, to: job.data.to }, 'E-mail enviado');
  }
}
