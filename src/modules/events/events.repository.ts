import type { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../../shared/infra/database/prisma';

export const eventsRepository = {
  create(data: Prisma.EventUncheckedCreateInput, db: DbClient = prisma) {
    return db.event.create({ data });
  },

  findById(id: string, db: DbClient = prisma) {
    return db.event.findUnique({ where: { id } });
  },

  list(db: DbClient = prisma) {
    return db.event.findMany({
      orderBy: { submissionStartsAt: 'desc' },
      include: { organizer: { select: { id: true, name: true } } },
    });
  },

  update(id: string, data: Prisma.EventUncheckedUpdateInput, db: DbClient = prisma) {
    return db.event.update({ where: { id }, data });
  },

  /** Condição no próprio DELETE: uma submissão concorrente não fica órfã */
  deleteIfEmpty(id: string, db: DbClient = prisma) {
    return db.event.deleteMany({ where: { id, submissions: { none: {} } } });
  },
};
