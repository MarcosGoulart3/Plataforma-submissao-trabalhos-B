import type { Prisma } from '@prisma/client';

/** Converte Decimal do Prisma em number para as respostas JSON */
export function toNumber(value: Prisma.Decimal | null | undefined): number | null {
  return value == null ? null : Number(value);
}
