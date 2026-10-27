import type { Prisma } from '@prisma/client';

export type Outcome = 'APPROVED' | 'REJECTED';

/** Média aritmética das notas, arredondada em 2 casas. Sem avaliações → null. */
export function calculateFinalGrade(grades: readonly number[]): number | null {
  if (grades.length === 0) return null;
  const sum = grades.reduce((acc, grade) => acc + grade, 0);
  // arredonda em centésimos evitando erros de ponto flutuante (ex.: 8.675 → 8.68)
  return Math.round((sum / grades.length + Number.EPSILON) * 100) / 100;
}

export interface GradedReview {
  grade: number | Prisma.Decimal | null;
  submittedAt: Date | null;
}

export interface GradeSummary {
  /** Média final: só existe quando TODAS as avaliações atribuídas foram concluídas */
  finalGrade: number | null;
  /** Média das avaliações concluídas até agora (informativa, não é a nota final) */
  partialGrade: number | null;
  completed: number;
  assigned: number;
}

export function summarizeGrades(reviews: readonly GradedReview[]): GradeSummary {
  const grades = reviews.filter((r) => r.submittedAt).map((r) => Number(r.grade));
  const complete = reviews.length > 0 && grades.length === reviews.length;
  return {
    finalGrade: complete ? calculateFinalGrade(grades) : null,
    partialGrade: calculateFinalGrade(grades),
    completed: grades.length,
    assigned: reviews.length,
  };
}

/** Aprovado se a nota final atingir o mínimo do evento; sem nota → reprovado */
export function decideOutcome(finalGrade: number | null, approvalThreshold: number): Outcome {
  return finalGrade !== null && finalGrade >= approvalThreshold ? 'APPROVED' : 'REJECTED';
}
