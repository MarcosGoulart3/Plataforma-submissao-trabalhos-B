import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { LogMailer } from './log.mailer';
import type { Mailer } from './mailer';
import { NodemailerMailer } from './nodemailer.mailer';

export type { Mailer, MailMessage } from './mailer';

export const mailer: Mailer =
  env.MAIL_DRIVER === 'smtp'
    ? new NodemailerMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT }, env.MAIL_FROM)
    : new LogMailer(logger);
