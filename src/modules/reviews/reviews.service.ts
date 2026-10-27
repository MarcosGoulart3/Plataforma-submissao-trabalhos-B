import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/http/errors';
import { hasRole } from '../../shared/http/middlewares/authorize';
import type { AuthUser } from '../../shared/http/types';
import { prisma, type DbClient } from '../../shared/infra/database/prisma';
import { formatDateTime } from '../../shared/utils/date';
import { toNumber } from '../../shared/utils/decimal';
import { assertDeadlineOpen, canPublishResults } from '../events/deadline.policy';
import { assertCanManageEvent } from '../events/event.policy';
import { eventsService } from '../events/events.service';
import { notificationsProducer } from '../notifications/notifications.producer';
import { submissionsRepository } from '../submissions/submissions.repository';
import { submissionRecipients, submissionsService } from '../submissions/submissions.service';
import { usersRepository } from '../users/users.repository';
import { assertNoConflictOfInterest } from './conflict-of-interest';
import { decideOutcome, summarizeGrades } from './final-grade';
import type { SubmitReviewInput } from './reviews.schemas';
import { reviewsRepository } from './reviews.repository';

/** Grava a nota final só quando todas as atribuições estão concluídas; senão, null */
async function refreshFinalGrade(submissionId: string, db: DbClient) {
  const { finalGrade } = summarizeGrades(await reviewsRepository.gradesBySubmission(submissionId, db));
  await db.submission.update({ where: { id: submissionId }, data: { finalGrade } });
}

export const reviewsService = {
  /** Organizador atribui avaliadores; a primeira atribuição move o trabalho para UNDER_REVIEW */
  async assignReviewers(user: AuthUser, submissionId: string, reviewerIds: string[]) {
    const submission = await submissionsService.getDetailsOrFail(submissionId);
    const { event } = submission;
    assertCanManageEvent(user, event);

    if (event.resultsPublishedAt || Date.now() >= event.reviewEndsAt.getTime()) {
      throw new BusinessRuleError('REVIEW_PERIOD_ENDED', 'O período de avaliação deste evento já terminou');
    }

    const reviewers = await usersRepository.findManyByIds(reviewerIds);
    const missing = reviewerIds.filter((id) => !reviewers.some((r) => r.id === id));
    if (missing.length) throw new NotFoundError(`Avaliador(es) ${missing.join(', ')}`);

    const alreadyAssigned = new Set(submission.reviews.map((r) => r.reviewerId));
    const duplicated = reviewers.filter((r) => alreadyAssigned.has(r.id));
    if (duplicated.length) {
      throw new ConflictError(
        duplicated.length === 1 ? 'Avaliador já atribuído a este trabalho' : 'Avaliadores já atribuídos a este trabalho',
        { reviewers: duplicated.map((r) => ({ id: r.id, name: r.name })) },
      );
    }

    for (const reviewer of reviewers) {
      if (!hasRole(reviewer, 'REVIEWER')) {
        throw new BusinessRuleError('NOT_A_REVIEWER', `${reviewer.name} não possui o papel de avaliador`);
      }
      assertNoConflictOfInterest(reviewer, submission);
    }

    await prisma.$transaction(async (tx) => {
      await reviewsRepository.createMany(submissionId, reviewers.map((r) => r.id), tx);
      // nova avaliação pendente: a média deixa de ser final
      await refreshFinalGrade(submissionId, tx);

      for (const reviewer of reviewers) {
        await notificationsProducer.enqueueEmail(tx, {
          template: 'reviewer-assigned',
          to: reviewer.email,
          data: {
            reviewerName: reviewer.name,
            submissionTitle: submission.title,
            eventName: event.name,
            reviewEndsAt: event.reviewEndsAt.toISOString(),
          },
        });
      }

      // updateMany condicional evita e-mail duplicado se duas atribuições ocorrerem em paralelo
      const moved = await tx.submission.updateMany({
        where: { id: submissionId, status: 'SUBMITTED' },
        data: { status: 'UNDER_REVIEW' },
      });
      if (moved.count === 1) {
        for (const recipient of submissionRecipients(submission)) {
          await notificationsProducer.enqueueEmail(tx, {
            template: 'submission-status-changed',
            to: recipient.email,
            data: {
              recipientName: recipient.name,
              submissionTitle: submission.title,
              eventName: event.name,
              status: 'UNDER_REVIEW',
              finalGrade: null,
            },
          });
        }
      }
    });

    return submissionsService.get(user, submissionId);
  },

  async unassignReviewer(user: AuthUser, submissionId: string, reviewerId: string) {
    const submission = await submissionsService.getDetailsOrFail(submissionId);
    assertCanManageEvent(user, submission.event);

    const review = await reviewsRepository.findAssignment(submissionId, reviewerId);
    if (!review) throw new NotFoundError('Atribuição');
    if (review.submittedAt) throw new ConflictError('A avaliação já foi enviada e não pode ser removida');

    await prisma.$transaction(async (tx) => {
      await reviewsRepository.delete(review.id, tx);
      // sem a pendência, as avaliações restantes podem completar a média
      await refreshFinalGrade(submissionId, tx);
    });
  },

  /** Lista do avaliador: avaliação cega (sem dados de autoria) */
  async listAssigned(user: AuthUser) {
    const reviews = await reviewsRepository.listByReviewer(user.id);
    return reviews.map((r) => ({
      id: r.id,
      grade: toNumber(r.grade),
      comments: r.comments,
      assignedAt: r.assignedAt,
      submittedAt: r.submittedAt,
      submission: {
        id: r.submission.id,
        title: r.submission.title,
        abstract: r.submission.abstract,
        area: r.submission.area,
        downloadUrl: `/submissions/${r.submission.id}/file`,
      },
      event: {
        id: r.submission.event.id,
        name: r.submission.event.name,
        reviewStartsAt: r.submission.event.reviewStartsAt,
        reviewEndsAt: r.submission.event.reviewEndsAt,
      },
    }));
  },

  /** Avaliador registra (ou corrige, dentro do prazo) nota e parecer */
  async submitReview(user: AuthUser, reviewId: string, input: SubmitReviewInput) {
    const review = await reviewsRepository.findById(reviewId);
    if (!review) throw new NotFoundError('Avaliação');
    if (review.reviewerId !== user.id) throw new ForbiddenError('Esta avaliação foi atribuída a outro avaliador');

    const { submission } = review;
    assertDeadlineOpen(submission.event, 'review');
    // revalida: um coautor pode ter sido vinculado depois da atribuição
    assertNoConflictOfInterest(user, submission);

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await reviewsRepository.submit(reviewId, input, tx);
      await refreshFinalGrade(submission.id, tx);
      return updated;
    });

    return { id: saved.id, grade: toNumber(saved.grade), comments: saved.comments, submittedAt: saved.submittedAt };
  },

  /**
   * Publica o resultado do evento: calcula a média de cada trabalho, define
   * APPROVED/REJECTED, e enfileira e-mails + certificados — tudo na MESMA transação.
   */
  async publishResults(user: AuthUser, eventId: string, options: { rejectUnreviewed: boolean }) {
    const event = await eventsService.getOrFail(eventId);
    assertCanManageEvent(user, event);
    if (event.resultsPublishedAt) {
      throw new BusinessRuleError('RESULTS_NOT_PUBLISHABLE', 'O resultado deste evento já foi publicado');
    }
    if (!canPublishResults(event)) {
      throw new BusinessRuleError(
        'RESULTS_NOT_PUBLISHABLE',
        `O resultado só pode ser publicado a partir de ${formatDateTime(event.resultAt)}`,
        { availableAt: event.resultAt },
      );
    }

    const submissions = await submissionsRepository.listByEvent(eventId, {});

    // nenhum trabalho é decidido com avaliação faltando (a média seria parcial)
    const pending = submissions.filter((s) => s.reviews.some((r) => !r.submittedAt));
    if (pending.length) {
      throw new ConflictError('Há submissões com avaliações pendentes', {
        submissions: pending.map((s) => {
          const { completed, assigned } = summarizeGrades(s.reviews);
          return { id: s.id, title: s.title, completed, assigned };
        }),
        hint: 'Aguarde as avaliações, prorrogue o período de avaliação ou remova as atribuições pendentes',
      });
    }

    const unassigned = submissions.filter((s) => s.reviews.length === 0);
    if (unassigned.length && !options.rejectUnreviewed) {
      throw new ConflictError('Há trabalhos sem avaliador atribuído', {
        submissions: unassigned.map((s) => ({ id: s.id, title: s.title })),
        hint: 'Envie { "rejectUnreviewed": true } para reprová-los automaticamente',
      });
    }

    const threshold = Number(event.approvalThreshold);
    const results = submissions.map((s) => {
      const { finalGrade } = summarizeGrades(s.reviews);
      return { submission: s, finalGrade, outcome: decideOutcome(finalGrade, threshold) };
    });

    await prisma.$transaction(
      async (tx) => {
        // trava otimista: impede publicação dupla concorrente
        const locked = await tx.event.updateMany({
          where: { id: eventId, resultsPublishedAt: null },
          data: { resultsPublishedAt: new Date() },
        });
        if (locked.count === 0) throw new ConflictError('O resultado deste evento já foi publicado');

        for (const { submission, finalGrade, outcome } of results) {
          await submissionsRepository.updateStatus(submission.id, outcome, finalGrade, tx);
          for (const recipient of submissionRecipients(submission)) {
            await notificationsProducer.enqueueEmail(tx, {
              template: 'submission-status-changed',
              to: recipient.email,
              data: {
                recipientName: recipient.name,
                submissionTitle: submission.title,
                eventName: event.name,
                status: outcome,
                finalGrade,
              },
            });
          }
          if (outcome === 'APPROVED') {
            await notificationsProducer.enqueueCertificate(tx, { submissionId: submission.id });
          }
        }
      },
      { timeout: 60_000 },
    );

    const approved = results.filter((r) => r.outcome === 'APPROVED').length;
    return {
      eventId,
      total: results.length,
      approved,
      rejected: results.length - approved,
      results: results.map((r) => ({
        submissionId: r.submission.id,
        title: r.submission.title,
        finalGrade: r.finalGrade,
        status: r.outcome,
      })),
    };
  },
};
