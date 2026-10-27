import { z } from 'zod';

// normaliza antes de validar (espaços e maiúsculas não tornam o e-mail inválido)
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido'));

export const registerSchema = z.object({
  name: z.string().trim().min(3, 'Nome deve ter ao menos 3 caracteres').max(120),
  email: emailSchema,
  password: z.string().min(8, 'Senha deve ter ao menos 8 caracteres').max(72), // limite do bcrypt
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
