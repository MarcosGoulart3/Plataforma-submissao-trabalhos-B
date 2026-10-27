import type { SubmissionStatus } from '@prisma/client';
import { BusinessRuleError, ForbiddenError } from '../../shared/http/errors';
import type { AuthUser } from '../../shared/http/types';
import { assertDeadlineOpen, type EventTimeline } from '../events/deadline.policy';
import { canManageEvent } from '../events/event.policy';

export interface SubmissionAccessContext {
  authorId: string;
  status: SubmissionStatus;
  coauthors: { email: string; userId: string | null }[];
  reviews: { reviewerId: string }[];
  event: EventTimeline & { organizerId: string };
}

export function isAuthor(user: AuthUser, submission: Pick<SubmissionAccessContext, 'authorId'>): boolean {
  return submission.authorId === user.id;
}

export function isCoauthor(user: AuthUser, submission: Pick<SubmissionAccessContext, 'coauthors'>): boolean {
  const email = user.email.toLowerCase();
  return submission.coauthors.some((c) => c.userId === user.id || c.email.toLowerCase() === email);
}

export function isAssignedReviewer(user: AuthUser, submission: Pick<SubmissionAccessContext, 'reviews'>): boolean {
  return submission.reviews.some((r) => r.reviewerId === user.id);
}

/** Como o usuário enxerga a submissão; null = sem acesso */
export type SubmissionViewer = 'manager' | 'author' | 'reviewer' | null;

export function viewerKind(user: AuthUser, submission: SubmissionAccessContext): SubmissionViewer {
  if (canManageEvent(user, submission.event)) return 'manager';
  if (isAuthor(user, submission) || isCoauthor(user, submission)) return 'author';
  if (isAssignedReviewer(user, submission)) return 'reviewer';
  return null;
}

export function assertCanView(user: AuthUser, submission: SubmissionAccessContext): Exclude<SubmissionViewer, null> {
  const kind = viewerKind(user, submission);
  if (!kind) throw new ForbiddenError('Você não tem acesso a esta submissão');
  return kind;
}

/**
 * Só o autor (quem submeteu) edita, só dentro do prazo de submissão
 * e só enquanto o trabalho ainda não entrou em avaliação.
 */
export function assertCanEdit(user: AuthUser, submission: SubmissionAccessContext, now = new Date()): void {
  if (!isAuthor(user, submission)) {
    throw new ForbiddenError('Apenas o autor que submeteu o trabalho pode editá-lo');
  }
  assertDeadlineOpen(submission.event, 'submission', now);
  if (submission.status !== 'SUBMITTED') {
    throw new BusinessRuleError('SUBMISSION_LOCKED', 'O trabalho já está em avaliação e não pode mais ser editado');
  }
}
