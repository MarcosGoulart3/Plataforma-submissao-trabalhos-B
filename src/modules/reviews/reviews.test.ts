import { BusinessRuleError } from '../../shared/http/errors';
import { assertNoConflictOfInterest, findConflictOfInterest } from './conflict-of-interest';
import { calculateFinalGrade, decideOutcome, summarizeGrades } from './final-grade';
import { submitReviewSchema } from './reviews.schemas';

describe('calculateFinalGrade', () => {
  it('calcula a média das avaliações', () => {
    expect(calculateFinalGrade([8, 9, 10])).toBe(9);
    expect(calculateFinalGrade([7.5, 8])).toBe(7.75);
  });

  it('arredonda em duas casas', () => {
    expect(calculateFinalGrade([10, 9, 9])).toBe(9.33);
    expect(calculateFinalGrade([8.67, 8.68])).toBe(8.68); // 8.675 → 8.68
  });

  it('sem avaliações retorna null', () => {
    expect(calculateFinalGrade([])).toBeNull();
  });
});

describe('decideOutcome', () => {
  it('aprova quando atinge o mínimo (inclusive)', () => {
    expect(decideOutcome(6, 6)).toBe('APPROVED');
    expect(decideOutcome(5.99, 6)).toBe('REJECTED');
    expect(decideOutcome(null, 6)).toBe('REJECTED');
  });
});

describe('conflito de interesse', () => {
  const submission = {
    authorId: 'author-id',
    coauthors: [
      { email: 'bruno@furg.br', userId: null },
      { email: 'carla@furg.br', userId: 'carla-id' },
    ],
  };

  it('avaliador autor do trabalho', () => {
    expect(findConflictOfInterest({ id: 'author-id', email: 'ana@furg.br' }, submission)).toBe('AUTHOR');
  });

  it('avaliador coautor (por e-mail, sem conta vinculada)', () => {
    expect(findConflictOfInterest({ id: 'bruno-id', email: 'Bruno@FURG.br' }, submission)).toBe('COAUTHOR');
  });

  it('avaliador coautor (por vínculo de usuário)', () => {
    expect(findConflictOfInterest({ id: 'carla-id', email: 'outro@x.com' }, submission)).toBe('COAUTHOR');
  });

  it('avaliador sem relação com o trabalho', () => {
    expect(findConflictOfInterest({ id: 'rita-id', email: 'rita@furg.br' }, submission)).toBeNull();
    expect(() => assertNoConflictOfInterest({ id: 'rita-id', email: 'rita@furg.br' }, submission)).not.toThrow();
  });

  it('assert lança BusinessRuleError com código CONFLICT_OF_INTEREST', () => {
    try {
      assertNoConflictOfInterest({ id: 'author-id', email: 'ana@furg.br' }, submission);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BusinessRuleError);
      expect((err as BusinessRuleError).code).toBe('CONFLICT_OF_INTEREST');
    }
  });
});

describe('submitReviewSchema', () => {
  it('aceita notas de 0 a 10 com até 2 casas', () => {
    expect(submitReviewSchema.safeParse({ grade: 8.55, comments: 'Trabalho bem escrito.' }).success).toBe(true);
    expect(submitReviewSchema.safeParse({ grade: 10.5, comments: 'Trabalho bem escrito.' }).success).toBe(false);
    expect(submitReviewSchema.safeParse({ grade: 8.555, comments: 'Trabalho bem escrito.' }).success).toBe(false);
  });
});

describe('summarizeGrades', () => {
  const done = (grade: number) => ({ grade, submittedAt: new Date() });
  const pending = { grade: null, submittedAt: null };

  it('sem nota final enquanto houver avaliação pendente; média parcial à parte', () => {
    expect(summarizeGrades([done(8.5), pending])).toEqual({ finalGrade: null, partialGrade: 8.5, completed: 1, assigned: 2 });
  });

  it('nota final quando todas as avaliações foram concluídas', () => {
    expect(summarizeGrades([done(8), done(9.5)])).toEqual({ finalGrade: 8.75, partialGrade: 8.75, completed: 2, assigned: 2 });
  });

  it('sem atribuições não há nota', () => {
    expect(summarizeGrades([])).toEqual({ finalGrade: null, partialGrade: null, completed: 0, assigned: 0 });
  });
});
