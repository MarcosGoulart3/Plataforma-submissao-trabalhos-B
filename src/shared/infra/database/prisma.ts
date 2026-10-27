import { PrismaClient, type Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

/** Cliente "normal" ou o cliente de uma transação interativa — os repositórios aceitam os dois */
export type DbClient = PrismaClient | Prisma.TransactionClient;
