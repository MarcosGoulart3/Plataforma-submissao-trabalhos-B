import type { Prisma, Role } from '@prisma/client';
import { prisma, type DbClient } from '../../shared/infra/database/prisma';

/** Campos seguros para expor (nunca o hash de senha) */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  roles: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export const usersRepository = {
  findByEmail(email: string, db: DbClient = prisma) {
    return db.user.findUnique({ where: { email } });
  },

  findByEmails(emails: string[], db: DbClient = prisma) {
    if (emails.length === 0) return Promise.resolve([]);
    return db.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
  },

  findById(id: string, db: DbClient = prisma) {
    return db.user.findUnique({ where: { id }, select: publicUserSelect });
  },

  findProfile(id: string, db: DbClient = prisma) {
    return db.user.findUnique({ where: { id }, select: { ...publicUserSelect, address: true } });
  },

  findManyByIds(ids: string[], db: DbClient = prisma) {
    return db.user.findMany({ where: { id: { in: ids } }, select: publicUserSelect });
  },

  list(filter: { role?: Role; search?: string }, db: DbClient = prisma) {
    return db.user.findMany({
      where: {
        ...(filter.role && { roles: { has: filter.role } }),
        ...(filter.search && {
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { email: { contains: filter.search, mode: 'insensitive' } },
          ],
        }),
      },
      select: publicUserSelect,
      orderBy: { name: 'asc' },
      take: 100,
    });
  },

  create(data: { name: string; email: string; passwordHash: string; roles?: Role[] }, db: DbClient = prisma) {
    return db.user.create({ data, select: publicUserSelect });
  },

  update(id: string, data: Prisma.UserUpdateInput, db: DbClient = prisma) {
    return db.user.update({ where: { id }, data, select: publicUserSelect });
  },

  upsertAddress(userId: string, address: Omit<Prisma.AddressUncheckedCreateInput, 'userId' | 'id'>, db: DbClient = prisma) {
    return db.address.upsert({
      where: { userId },
      create: { ...address, userId },
      update: address,
    });
  },

  /** Vincula ao novo usuário os registros de coautoria feitos antes do cadastro */
  linkCoauthorships(userId: string, email: string, db: DbClient = prisma) {
    return db.submissionCoauthor.updateMany({ where: { email, userId: null }, data: { userId } });
  },
};
