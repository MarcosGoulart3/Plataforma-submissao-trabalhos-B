import { SubmissionStatus } from '@prisma/client';
import { z } from 'zod';
import { emailSchema } from '../auth/auth.schemas';

export const MAX_COAUTHORS = 10;

const coauthorSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: emailSchema,
});

/** Em multipart/form-data os coautores chegam como string JSON */
const coauthorsField = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value; // deixa o Zod acusar o tipo inválido
    }
  },
  z
    .array(coauthorSchema)
    .max(MAX_COAUTHORS, `No máximo ${MAX_COAUTHORS} coautores`)
    .refine((list) => new Set(list.map((c) => c.email)).size === list.length, 'Coautores com e-mail repetido'),
);

const submissionFields = z.object({
  title: z.string().trim().min(5).max(300),
  abstract: z.string().trim().max(5000).optional(),
  area: z.string().trim().min(2),
  coauthors: coauthorsField,
});

export const createSubmissionSchema = submissionFields.extend({ coauthors: coauthorsField.default([]) });

// sem default: no Zod 4 o default sobrevive ao .partial() e uma edição parcial apagaria os coautores
export const updateSubmissionSchema = submissionFields.partial();

export const submissionIdParamsSchema = z.object({ id: z.uuid() });
export const eventIdParamsSchema = z.object({ eventId: z.uuid() });

export const listEventSubmissionsQuerySchema = z.object({
  status: z.enum(SubmissionStatus).optional(),
  area: z.string().trim().min(1).optional(),
});

export type CoauthorInput = z.infer<typeof coauthorSchema>;
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
export type UpdateSubmissionInput = z.infer<typeof updateSubmissionSchema>;
