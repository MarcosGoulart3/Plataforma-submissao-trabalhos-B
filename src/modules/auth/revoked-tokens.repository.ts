import { prisma, type DbClient } from '../../shared/infra/database/prisma';

export const revokedTokensRepository = {
  /** Registra o token e aproveita para limpar os que já expiraram (não precisam mais da lista) */
  async revoke(jti: string, expiresAt: Date, db: DbClient = prisma): Promise<void> {
    await db.revokedToken.upsert({ where: { jti }, create: { jti, expiresAt }, update: {} });
    await db.revokedToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  },
};
