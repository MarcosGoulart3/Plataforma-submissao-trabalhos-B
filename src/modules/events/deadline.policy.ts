import { BusinessRuleError } from '../../shared/http/errors';

/** Datas que definem as janelas do evento */
export interface EventTimeline {
  submissionStartsAt: Date;
  submissionEndsAt: Date;
  reviewStartsAt: Date;
  reviewEndsAt: Date;
  resultAt: Date;
}

export interface EventDeadlines extends EventTimeline {
  resultsPublishedAt: Date | null;
}

export type DeadlineName = 'submission' | 'review';

/** Janela fechada no início e aberta no fim: [start, end) */
function isWithin(now: Date, start: Date, end: Date) {
  return now.getTime() >= start.getTime() && now.getTime() < end.getTime();
}

export function isSubmissionOpen(event: EventTimeline, now = new Date()): boolean {
  return isWithin(now, event.submissionStartsAt, event.submissionEndsAt);
}

export function isReviewOpen(event: EventTimeline, now = new Date()): boolean {
  return isWithin(now, event.reviewStartsAt, event.reviewEndsAt);
}

/** Resultado só pode ser publicado a partir da data anunciada (resultAt ≥ reviewEndsAt), e uma única vez */
export function canPublishResults(event: EventDeadlines, now = new Date()): boolean {
  return event.resultsPublishedAt === null && now.getTime() >= event.resultAt.getTime();
}

export function assertDeadlineOpen(event: EventTimeline, deadline: DeadlineName, now = new Date()): void {
  if (deadline === 'submission' && !isSubmissionOpen(event, now)) {
    throw new BusinessRuleError('SUBMISSION_PERIOD_CLOSED', 'O prazo de submissão não está aberto', {
      opensAt: event.submissionStartsAt,
      closesAt: event.submissionEndsAt,
    });
  }
  if (deadline === 'review' && !isReviewOpen(event, now)) {
    throw new BusinessRuleError('REVIEW_PERIOD_CLOSED', 'O prazo de avaliação não está aberto', {
      opensAt: event.reviewStartsAt,
      closesAt: event.reviewEndsAt,
    });
  }
}

/** Resumo exibido ao front: o que está aberto agora */
export function deadlineStatus(event: EventDeadlines, now = new Date()) {
  return {
    submission: { opensAt: event.submissionStartsAt, closesAt: event.submissionEndsAt, open: isSubmissionOpen(event, now) },
    review: { opensAt: event.reviewStartsAt, closesAt: event.reviewEndsAt, open: isReviewOpen(event, now) },
    result: {
      expectedAt: event.resultAt,
      published: event.resultsPublishedAt !== null,
      publishedAt: event.resultsPublishedAt,
      canPublish: canPublishResults(event, now),
    },
  };
}

/** Valida a ordem cronológica dos prazos; devolve a lista de problemas */
export function validateTimeline(t: EventTimeline): string[] {
  const errors: string[] = [];
  if (t.submissionStartsAt >= t.submissionEndsAt) errors.push('Início da submissão deve ser antes do fim');
  if (t.reviewStartsAt < t.submissionEndsAt) errors.push('Avaliação deve começar após o fim da submissão');
  if (t.reviewStartsAt >= t.reviewEndsAt) errors.push('Início da avaliação deve ser antes do fim');
  if (t.resultAt < t.reviewEndsAt) errors.push('Divulgação do resultado deve ser após o fim da avaliação');
  return errors;
}
