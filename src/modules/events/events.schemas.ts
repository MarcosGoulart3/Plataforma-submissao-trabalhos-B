import { z } from 'zod';
import { validateTimeline } from './deadline.policy';

const eventFields = z.object({
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional(),
  areas: z
    .array(z.string().trim().min(2).max(100))
    .min(1, 'Informe ao menos uma área temática')
    .transform((areas) => [...new Set(areas)]),
  submissionStartsAt: z.coerce.date(),
  submissionEndsAt: z.coerce.date(),
  reviewStartsAt: z.coerce.date(),
  reviewEndsAt: z.coerce.date(),
  resultAt: z.coerce.date(),
  approvalThreshold: z.number().min(0).max(10).default(6),
});

export const createEventSchema = eventFields.superRefine((event, ctx) => {
  for (const message of validateTimeline(event)) ctx.addIssue({ code: 'custom', message });
});

/** No update os prazos são revalidados no service, já combinados com os valores atuais */
export const updateEventSchema = eventFields.partial().omit({ approvalThreshold: true }).extend({
  approvalThreshold: z.number().min(0).max(10).optional(),
});

export const eventIdParamsSchema = z.object({ id: z.uuid() });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
