import type { SubmissionStatus } from '@prisma/client';

/** Nomes das filas (pg-boss). API e worker importam daqui para não divergirem. */
export const JOBS = {
  SEND_EMAIL: 'email.send',
  GENERATE_CERTIFICATE: 'certificate.generate',
  DEAD_LETTER: 'jobs.dead-letter',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

// ---- Payloads ------------------------------------------------------------

export interface EmailTemplateData {
  'submission-received': { recipientName: string; submissionTitle: string; eventName: string };
  'submission-status-changed': {
    recipientName: string;
    submissionTitle: string;
    eventName: string;
    status: SubmissionStatus;
    finalGrade: number | null;
  };
  'reviewer-assigned': { reviewerName: string; submissionTitle: string; eventName: string; reviewEndsAt: string };
  'certificate-issued': {
    recipientName: string;
    submissionTitle: string;
    eventName: string;
    downloadUrl: string;
    verificationCode: string;
  };
}

export type EmailTemplateName = keyof EmailTemplateData;

/** União discriminada: o template define o formato de `data` */
export type SendEmailPayload = {
  [T in EmailTemplateName]: { template: T; to: string; data: EmailTemplateData[T] };
}[EmailTemplateName];

export interface GenerateCertificatePayload {
  submissionId: string;
}
