import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { SubmissionStatus } from '@prisma/client';
import { BadRequestError, BusinessRuleError, NotFoundError } from '../../shared/http/errors';
import type { AuthUser } from '../../shared/http/types';
import { prisma } from '../../shared/infra/database/prisma';
import { storage } from '../../shared/infra/storage';
import { toNumber } from '../../shared/utils/decimal';
import { logger } from '../../shared/utils/logger';
import { assertDeadlineOpen } from '../events/deadline.policy';
import { assertCanManageEvent } from '../events/event.policy';
import { eventsService } from '../events/events.service';
import { notificationsProducer } from '../notifications/notifications.producer';
import { summarizeGrades } from '../reviews/final-grade';
import { usersRepository } from '../users/users.repository';
import { assertCanEdit, assertCanView, type SubmissionViewer } from './submission.policy';
import type { CoauthorInput, CreateSubmissionInput, UpdateSubmissionInput } from './submissions.schemas';
import { submissionsRepository, type SubmissionDetails } from './submissions.repository';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export interface Recipient {
  name: string;
  email: string;
}

/**
 * Autor + coautores, sem repetição — destinatários das notificações do trabalho.
 * Cada um recebe um e-mail próprio: ninguém vê o endereço dos demais.
 */
export function submissionRecipients(submission: Pick<SubmissionDetails, 'author' | 'coauthors'>): Recipient[] {
  const byEmail = new Map<string, Recipient>();
  for (const { name, email } of [submission.author, ...submission.coauthors]) {
    const key = email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, { name, email });
  }
  return [...byEmail.values()];
}

/**
 * Formata a resposta conforme quem está vendo:
 * - avaliador: avaliação cega (sem autores);
 * - autor/coautor: pareceres anônimos só depois da publicação do resultado;
 * - organizador: tudo.
 */
export function toSubmissionResponse(s: SubmissionDetails, viewer: Exclude<SubmissionViewer, null>) {
  const base = {
    id: s.id,
    event: { id: s.event.id, name: s.event.name },
    title: s.title,
    abstract: s.abstract,
    area: s.area,
    status: s.status,
    file: { name: s.fileName, size: s.fileSize, downloadUrl: `/submissions/${s.id}/file` },
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
  if (viewer === 'reviewer') return base;

  const withAuthors = {
    ...base,
    author: s.author,
    coauthors: s.coauthors.map((c) => ({ name: c.name, email: c.email })),
  };

  const published = s.event.resultsPublishedAt !== null;

  if (viewer === 'manager') {
    const { finalGrade, partialGrade, completed, assigned } = summarizeGrades(s.reviews);
    return {
      ...withAuthors,
      // com avaliação pendente não há nota final; a média parcial vem rotulada em reviewProgress
      finalGrade: published ? toNumber(s.finalGrade) : finalGrade,
      reviewProgress: { completed, assigned, partialGrade },
      reviews: s.reviews.map((r) => ({
        id: r.id,
        reviewer: r.reviewer,
        grade: toNumber(r.grade),
        comments: r.comments,
        assignedAt: r.assignedAt,
        submittedAt: r.submittedAt,
      })),
    };
  }

  return {
    ...withAuthors,
    finalGrade: published ? toNumber(s.finalGrade) : null,
    reviews: published
      ? s.reviews.filter((r) => r.submittedAt).map((r) => ({ grade: toNumber(r.grade), comments: r.comments }))
      : [],
  };
}

async function resolveCoauthors(author: AuthUser, coauthors: CoauthorInput[]) {
  if (coauthors.some((c) => c.email === author.email.toLowerCase())) {
    throw new BadRequestError('O autor não deve ser listado como coautor');
  }
  const users = await usersRepository.findByEmails(coauthors.map((c) => c.email));
  const idByEmail = new Map(users.map((u) => [u.email, u.id]));
  return coauthors.map((c) => ({ name: c.name, email: c.email, userId: idByEmail.get(c.email) ?? null }));
}

function assertAreaBelongsToEvent(area: string, areas: string[]) {
  if (!areas.includes(area)) {
    throw new BusinessRuleError('INVALID_AREA', `Área "${area}" não existe neste evento`, { areas });
  }
}

function fileKeyFor(eventId: string) {
  return `submissions/${eventId}/${randomUUID()}.pdf`;
}

/** Remove arquivo órfão sem mascarar o erro original */
async function safeDelete(key: string) {
  await storage.delete(key).catch((err) => logger.warn({ err, key }, 'Falha ao remover arquivo do storage'));
}

export const submissionsService = {
  async getDetailsOrFail(id: string): Promise<SubmissionDetails> {
    const submission = await submissionsRepository.findById(id);
    if (!submission) throw new NotFoundError('Submissão');
    return submission;
  },

  async create(user: AuthUser, eventId: string, input: CreateSubmissionInput, file: UploadedFile | undefined) {
    const event = await eventsService.getOrFail(eventId);
    assertDeadlineOpen(event, 'submission');
    if (!file) throw new BadRequestError('O arquivo PDF do resumo é obrigatório (campo "file")');
    assertAreaBelongsToEvent(input.area, event.areas);
    const coauthors = await resolveCoauthors(user, input.coauthors);

    // o upload acontece antes da transação; se ela falhar, o arquivo é removido (compensação)
    const fileKey = fileKeyFor(eventId);
    await storage.put(fileKey, file.buffer, 'application/pdf');

    try {
      const submission = await prisma.$transaction(async (tx) => {
        const created = await submissionsRepository.create(
          {
            eventId,
            authorId: user.id,
            title: input.title,
            abstract: input.abstract,
            area: input.area,
            fileKey,
            fileName: file.originalname,
            fileSize: file.size,
            coauthors,
          },
          tx,
        );
        for (const recipient of submissionRecipients(created)) {
          await notificationsProducer.enqueueEmail(tx, {
            template: 'submission-received',
            to: recipient.email,
            data: { recipientName: recipient.name, submissionTitle: created.title, eventName: event.name },
          });
        }
        return created;
      });
      return toSubmissionResponse(submission, 'author');
    } catch (err) {
      await safeDelete(fileKey);
      throw err;
    }
  },

  async update(user: AuthUser, id: string, input: UpdateSubmissionInput, file: UploadedFile | undefined) {
    const current = await this.getDetailsOrFail(id);
    assertCanEdit(user, current);
    if (input.area) assertAreaBelongsToEvent(input.area, current.event.areas);
    const coauthors = input.coauthors ? await resolveCoauthors(user, input.coauthors) : undefined;

    const newFileKey = file ? fileKeyFor(current.eventId) : null;
    if (file && newFileKey) await storage.put(newFileKey, file.buffer, 'application/pdf');

    try {
      const updated = await submissionsRepository.update(
        id,
        {
          title: input.title,
          abstract: input.abstract,
          area: input.area,
          ...(file && newFileKey && { fileKey: newFileKey, fileName: file.originalname, fileSize: file.size }),
        },
        coauthors,
      );
      if (newFileKey) await safeDelete(current.fileKey);
      return toSubmissionResponse(updated, 'author');
    } catch (err) {
      if (newFileKey) await safeDelete(newFileKey);
      throw err;
    }
  },

  async get(user: AuthUser, id: string) {
    const submission = await this.getDetailsOrFail(id);
    const viewer = assertCanView(user, submission);
    return toSubmissionResponse(submission, viewer);
  },

  async listMine(user: AuthUser) {
    const submissions = await submissionsRepository.listByParticipant(user);
    return submissions.map((s) => toSubmissionResponse(s, 'author'));
  },

  async listByEvent(user: AuthUser, eventId: string, filter: { status?: SubmissionStatus; area?: string }) {
    const event = await eventsService.getOrFail(eventId);
    assertCanManageEvent(user, event);
    const submissions = await submissionsRepository.listByEvent(eventId, filter);
    return submissions.map((s) => toSubmissionResponse(s, 'manager'));
  },

  async openFile(user: AuthUser, id: string): Promise<{ stream: Readable; fileName: string }> {
    const submission = await this.getDetailsOrFail(id);
    const viewer = assertCanView(user, submission);
    const stream = await storage.get(submission.fileKey);
    // avaliador não vê o nome original do arquivo (pode identificar o autor)
    return { stream, fileName: viewer === 'reviewer' ? `trabalho-${submission.id}.pdf` : submission.fileName };
  },
};
