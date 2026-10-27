import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '../../shared/http/errors';
import type { AuthUser } from '../../shared/http/types';
import { env } from '../../shared/config/env';
import { prisma } from '../../shared/infra/database/prisma';
import { storage } from '../../shared/infra/storage';
import { toNumber } from '../../shared/utils/decimal';
import { logger } from '../../shared/utils/logger';
import { canManageEvent } from '../events/event.policy';
import { notificationsProducer } from '../notifications/notifications.producer';
import { isAuthor, isCoauthor } from '../submissions/submission.policy';
import { submissionsRepository } from '../submissions/submissions.repository';
import { submissionRecipients } from '../submissions/submissions.service';
import { renderCertificatePdf } from './certificate.template';
import { certificatesRepository, type CertificateDetails } from './certificates.repository';

/** Ex.: 7F3A-91C2-0BDE — 48 bits aleatórios, fácil de digitar */
export function generateVerificationCode(): string {
  return randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');
}

function toCertificateResponse(c: CertificateDetails) {
  return {
    id: c.id,
    verificationCode: c.verificationCode,
    issuedAt: c.issuedAt,
    downloadUrl: `/certificates/${c.id}/download`,
    submission: { id: c.submission.id, title: c.submission.title },
    event: { id: c.submission.event.id, name: c.submission.event.name },
  };
}

export const certificatesService = {
  /**
   * Chamado pelo worker. Idempotente: se o job for reprocessado (retry ou
   * entrega duplicada), não gera um segundo certificado nem reenvia o e-mail.
   */
  async issueForSubmission(submissionId: string) {
    const submission = await submissionsRepository.findById(submissionId);
    if (!submission) {
      logger.warn({ submissionId }, 'Certificado: submissão não existe; job descartado');
      return null;
    }
    if (submission.status !== 'APPROVED') {
      logger.warn({ submissionId, status: submission.status }, 'Certificado: trabalho não aprovado; job descartado');
      return null;
    }

    const existing = await certificatesRepository.findBySubmission(submissionId);
    if (existing) return existing;

    const verificationCode = generateVerificationCode();
    const issuedAt = new Date();
    const pdf = await renderCertificatePdf({
      authors: [submission.author.name, ...submission.coauthors.map((c) => c.name)],
      submissionTitle: submission.title,
      area: submission.area,
      eventName: submission.event.name,
      finalGrade: toNumber(submission.finalGrade),
      issuedAt,
      verificationCode,
      verificationUrl: `${env.APP_PUBLIC_URL}/certificates/verify/${verificationCode}`,
    });

    // chave determinística: um retry sobrescreve o mesmo arquivo em vez de criar outro
    const storageKey = `certificates/${submissionId}.pdf`;
    await storage.put(storageKey, pdf, 'application/pdf');

    try {
      return await prisma.$transaction(async (tx) => {
        const certificate = await certificatesRepository.create({ submissionId, storageKey, verificationCode }, tx);
        for (const recipient of submissionRecipients(submission)) {
          await notificationsProducer.enqueueEmail(tx, {
            template: 'certificate-issued',
            to: recipient.email,
            data: {
              recipientName: recipient.name,
              submissionTitle: submission.title,
              eventName: submission.event.name,
              downloadUrl: `${env.APP_PUBLIC_URL}/certificates/${certificate.id}/download`,
              verificationCode,
            },
          });
        }
        return certificate;
      });
    } catch (err) {
      // outro worker venceu a corrida e já criou o certificado
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return certificatesRepository.findBySubmission(submissionId);
      }
      throw err;
    }
  },

  async listMine(user: AuthUser) {
    const certificates = await certificatesRepository.listByParticipant(user);
    return certificates.map(toCertificateResponse);
  },

  async openFile(user: AuthUser, id: string) {
    const certificate = await certificatesRepository.findById(id);
    if (!certificate) throw new NotFoundError('Certificado');
    const { submission } = certificate;
    const allowed = isAuthor(user, submission) || isCoauthor(user, submission) || canManageEvent(user, submission.event);
    if (!allowed) throw new ForbiddenError('Você não tem acesso a este certificado');

    return { stream: await storage.get(certificate.storageKey), fileName: `certificado-${certificate.verificationCode}.pdf` };
  },

  /** Endpoint público: confirma a autenticidade de um certificado impresso */
  async verify(code: string) {
    const certificate = await certificatesRepository.findByCode(code.trim().toUpperCase());
    if (!certificate) return { valid: false as const };
    const { submission } = certificate;
    return {
      valid: true as const,
      issuedAt: certificate.issuedAt,
      event: submission.event.name,
      title: submission.title,
      authors: [submission.author.name, ...submission.coauthors.map((c) => c.name)],
    };
  },
};
