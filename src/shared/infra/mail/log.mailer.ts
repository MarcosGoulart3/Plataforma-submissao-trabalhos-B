import type { Logger } from 'pino';
import type { MailMessage, Mailer } from './mailer';

/** E-mail simulado: apenas registra a mensagem no log */
export class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.info({ to: message.to, subject: message.subject, body: message.text }, '[e-mail simulado]');
  }
}
