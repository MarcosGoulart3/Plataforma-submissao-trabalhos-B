import { z } from 'zod';

export const assignReviewersSchema = z.object({
  reviewerIds: z
    .array(z.uuid())
    .min(1)
    .max(10)
    .transform((ids) => [...new Set(ids)]),
});

export const submitReviewSchema = z.object({
  grade: z
    .number()
    .min(0, 'Nota mínima é 0')
    .max(10, 'Nota máxima é 10')
    // n * 100 pode não ser inteiro exato em ponto flutuante (8.55 * 100 = 855.0000000000001)
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-9, 'Use no máximo 2 casas decimais'),
  comments: z.string().trim().min(10, 'O parecer deve ter ao menos 10 caracteres').max(10_000),
});

export const publishResultsSchema = z.object({
  /** Trabalhos sem nenhuma avaliação concluída são reprovados (em vez de bloquear a publicação) */
  rejectUnreviewed: z.boolean().default(false),
});

export const submissionIdParamsSchema = z.object({ submissionId: z.uuid() });
export const unassignParamsSchema = z.object({ submissionId: z.uuid(), reviewerId: z.uuid() });
export const reviewIdParamsSchema = z.object({ id: z.uuid() });
export const eventIdParamsSchema = z.object({ eventId: z.uuid() });

export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
