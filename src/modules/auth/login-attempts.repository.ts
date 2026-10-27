import { prisma, type DbClient } from '../../shared/infra/database/prisma';

export const loginAttemptsRepository = {
  find(email: string, db: DbClient = prisma) {
    return db.loginAttempt.findUnique({ where: { email } });
  },

  /** Incremento atômico: tentativas paralelas não se perdem na contagem */
  increment(email: string, db: DbClient = prisma) {
    return db.loginAttempt.upsert({
      where: { email },
      create: { email, failures: 1 },
      update: { failures: { increment: 1 } },
    });
  },

  /** Inicia uma nova janela de contagem com esta falha */
  restart(email: string, now: Date, db: DbClient = prisma) {
    return db.loginAttempt.upsert({
      where: { email },
      create: { email, failures: 1, windowStartsAt: now },
      update: { failures: 1, windowStartsAt: now, lockedUntil: null },
    });
  },

  lock(email: string, until: Date, db: DbClient = prisma) {
    return db.loginAttempt.update({ where: { email }, data: { lockedUntil: until } });
  },

  clear(email: string, db: DbClient = prisma) {
    return db.loginAttempt.deleteMany({ where: { email } });
  },
};
