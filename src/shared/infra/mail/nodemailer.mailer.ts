import nodemailer, { type Transporter } from 'nodemailer';
import type { MailMessage, Mailer } from './mailer';

/** Envio via SMTP (em desenvolvimento, o MailHog captura as mensagens) */
export class NodemailerMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(
    options: { host: string; port: number },
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport({ host: options.host, port: options.port, secure: false });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}
