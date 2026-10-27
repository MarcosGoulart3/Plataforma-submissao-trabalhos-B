import type { SubmissionStatus } from '@prisma/client';
import type { EmailTemplateData, EmailTemplateName, SendEmailPayload } from '../../../shared/infra/queue/jobs';
import { formatDateTime } from '../../../shared/utils/date';
import { layout, type RenderedEmail } from './layout';

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  SUBMITTED: 'Submetido',
  UNDER_REVIEW: 'Em avaliação',
  APPROVED: 'Aprovado',
  REJECTED: 'Reprovado',
};

const templates: { [T in EmailTemplateName]: (data: EmailTemplateData[T]) => RenderedEmail } = {
  'submission-received': (d) =>
    layout(`[${d.eventName}] Submissão recebida`, `Olá, ${d.recipientName}!`, [
      `Recebemos o trabalho "${d.submissionTitle}" no evento ${d.eventName}.`,
      'Você pode editá-lo enquanto o prazo de submissão estiver aberto.',
    ]),

  'submission-status-changed': (d) => {
    const paragraphs = [`O trabalho "${d.submissionTitle}" mudou de situação: ${STATUS_LABEL[d.status]}.`];
    if (d.finalGrade !== null) paragraphs.push(`Nota final: ${d.finalGrade.toFixed(2)}.`);
    if (d.status === 'APPROVED') paragraphs.push('Parabéns! O certificado será emitido em instantes.');
    return layout(`[${d.eventName}] ${STATUS_LABEL[d.status]}: ${d.submissionTitle}`, `Olá, ${d.recipientName}!`, paragraphs);
  },

  'reviewer-assigned': (d) =>
    layout(`[${d.eventName}] Novo trabalho para avaliar`, `Olá, ${d.reviewerName}!`, [
      `Você foi designado(a) para avaliar o trabalho "${d.submissionTitle}".`,
      `Prazo para a avaliação: ${formatDateTime(d.reviewEndsAt)}.`,
    ]),

  'certificate-issued': (d) =>
    layout(`[${d.eventName}] Seu certificado está disponível`, `Olá, ${d.recipientName}!`, [
      `O certificado do trabalho "${d.submissionTitle}" foi emitido.`,
      `Baixe em: ${d.downloadUrl}`,
      `Código de verificação: ${d.verificationCode}`,
    ]),
};

export function renderEmail(payload: SendEmailPayload): RenderedEmail {
  const render = templates[payload.template] as (data: SendEmailPayload['data']) => RenderedEmail;
  return render(payload.data);
}
