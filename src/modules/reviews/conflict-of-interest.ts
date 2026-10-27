import { BusinessRuleError } from '../../shared/http/errors';

export interface ReviewerIdentity {
  id: string;
  email: string;
}

export interface SubmissionAuthorship {
  authorId: string;
  coauthors: { email: string; userId: string | null }[];
}

export type ConflictReason = 'AUTHOR' | 'COAUTHOR';

/**
 * Avaliador não pode avaliar trabalho próprio nem trabalho do qual é coautor.
 * O coautor é reconhecido pelo vínculo de usuário OU pelo e-mail (pode ter
 * sido listado antes de criar conta).
 */
export function findConflictOfInterest(
  reviewer: ReviewerIdentity,
  submission: SubmissionAuthorship,
): ConflictReason | null {
  if (submission.authorId === reviewer.id) return 'AUTHOR';
  const email = reviewer.email.trim().toLowerCase();
  const isCoauthor = submission.coauthors.some((c) => c.userId === reviewer.id || c.email.trim().toLowerCase() === email);
  return isCoauthor ? 'COAUTHOR' : null;
}

export function assertNoConflictOfInterest(reviewer: ReviewerIdentity, submission: SubmissionAuthorship): void {
  const reason = findConflictOfInterest(reviewer, submission);
  if (reason) {
    const message =
      reason === 'AUTHOR'
        ? 'Conflito de interesse: o avaliador é o autor do trabalho'
        : 'Conflito de interesse: o avaliador é coautor do trabalho';
    throw new BusinessRuleError('CONFLICT_OF_INTEREST', message, { reviewerId: reviewer.id, reason });
  }
}
