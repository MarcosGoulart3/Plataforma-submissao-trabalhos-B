import { BusinessRuleError } from '../../shared/http/errors';
import {
  assertDeadlineOpen,
  canPublishResults,
  deadlineStatus,
  isReviewOpen,
  isSubmissionOpen,
  validateTimeline,
} from './deadline.policy';
import { canManageEvent } from './event.policy';
import { createEventSchema } from './events.schemas';

const d = (iso: string) => new Date(iso);

const event = {
  submissionStartsAt: d('2026-03-01T00:00:00Z'),
  submissionEndsAt: d('2026-04-01T00:00:00Z'),
  reviewStartsAt: d('2026-04-02T00:00:00Z'),
  reviewEndsAt: d('2026-05-01T00:00:00Z'),
  resultAt: d('2026-05-10T00:00:00Z'),
  resultsPublishedAt: null,
};

describe('deadline.policy', () => {
  it('submissão aberta somente dentro da janela [início, fim)', () => {
    expect(isSubmissionOpen(event, d('2026-02-28T23:59:59Z'))).toBe(false);
    expect(isSubmissionOpen(event, d('2026-03-01T00:00:00Z'))).toBe(true);
    expect(isSubmissionOpen(event, d('2026-03-31T23:59:59Z'))).toBe(true);
    expect(isSubmissionOpen(event, d('2026-04-01T00:00:00Z'))).toBe(false);
  });

  it('avaliação aberta somente dentro da sua janela', () => {
    expect(isReviewOpen(event, d('2026-03-15T00:00:00Z'))).toBe(false);
    expect(isReviewOpen(event, d('2026-04-15T00:00:00Z'))).toBe(true);
  });

  it('assertDeadlineOpen lança erro de regra de negócio com o código do prazo', () => {
    expect(() => assertDeadlineOpen(event, 'submission', d('2026-04-10T00:00:00Z'))).toThrow(BusinessRuleError);
    try {
      assertDeadlineOpen(event, 'submission', d('2026-04-10T00:00:00Z'));
    } catch (err) {
      expect((err as BusinessRuleError).code).toBe('SUBMISSION_PERIOD_CLOSED');
    }
    expect(() => assertDeadlineOpen(event, 'review', d('2026-04-10T00:00:00Z'))).not.toThrow();
  });

  it('resultado só pode ser publicado a partir da data de resultado e uma única vez', () => {
    expect(canPublishResults(event, d('2026-04-30T00:00:00Z'))).toBe(false);
    // avaliação encerrada, mas antes da data anunciada
    expect(canPublishResults(event, d('2026-05-01T00:00:00Z'))).toBe(false);
    expect(canPublishResults(event, d('2026-05-09T23:59:59Z'))).toBe(false);
    expect(canPublishResults(event, d('2026-05-10T00:00:00Z'))).toBe(true);
    expect(canPublishResults({ ...event, resultsPublishedAt: d('2026-05-10T00:00:00Z') }, d('2026-05-11T00:00:00Z'))).toBe(
      false,
    );
  });

  it('deadlineStatus resume as janelas', () => {
    const status = deadlineStatus(event, d('2026-03-10T00:00:00Z'));
    expect(status.submission.open).toBe(true);
    expect(status.review.open).toBe(false);
    expect(status.result.published).toBe(false);
  });

  it('validateTimeline aponta prazos fora de ordem', () => {
    expect(validateTimeline(event)).toEqual([]);
    expect(validateTimeline({ ...event, reviewStartsAt: d('2026-03-15T00:00:00Z') })).toContain(
      'Avaliação deve começar após o fim da submissão',
    );
  });
});

describe('createEventSchema', () => {
  it('rejeita evento com prazos inconsistentes', () => {
    const result = createEventSchema.safeParse({
      name: 'MEPERG 2026',
      areas: ['Computação'],
      submissionStartsAt: '2026-04-01',
      submissionEndsAt: '2026-03-01',
      reviewStartsAt: '2026-04-02',
      reviewEndsAt: '2026-05-01',
      resultAt: '2026-05-10',
    });
    expect(result.success).toBe(false);
  });
});

describe('event.policy', () => {
  const organizer = { id: 'org-1', name: 'Org', email: 'o@x.com', roles: ['ORGANIZER' as const] };

  it('organizador dono gerencia; outro organizador não; admin sempre', () => {
    expect(canManageEvent(organizer, { organizerId: 'org-1' })).toBe(true);
    expect(canManageEvent(organizer, { organizerId: 'org-2' })).toBe(false);
    expect(canManageEvent({ ...organizer, id: 'adm', roles: ['ADMIN'] }, { organizerId: 'org-1' })).toBe(true);
  });

  it('dono que perdeu o papel de organizador não gerencia mais', () => {
    expect(canManageEvent({ ...organizer, roles: ['PARTICIPANT'] }, { organizerId: 'org-1' })).toBe(false);
  });
});
