import { Role } from '@prisma/client';
import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(3).max(120),
});

const optionalText = z.string().trim().max(200).optional();

/** Logradouro/bairro/cidade/UF são opcionais: vêm do ViaCEP; se informados, prevalecem */
export const addressSchema = z.object({
  cep: z.string().trim().min(8).max(9),
  number: z.string().trim().min(1).max(20),
  complement: optionalText,
  street: optionalText,
  neighborhood: optionalText,
  city: optionalText,
  state: z
    .string()
    .trim()
    .length(2)
    .transform((uf) => uf.toUpperCase())
    .optional(),
});

export const cepParamsSchema = z.object({ cep: z.string() });

export const listUsersQuerySchema = z.object({
  role: z.enum(Role).optional(),
  search: z.string().trim().min(1).optional(),
});

export const updateRolesSchema = z.object({
  roles: z.array(z.enum(Role)).min(1).transform((roles) => [...new Set(roles)]),
});

export const userIdParamsSchema = z.object({ id: z.uuid() });

export type AddressInput = z.infer<typeof addressSchema>;
