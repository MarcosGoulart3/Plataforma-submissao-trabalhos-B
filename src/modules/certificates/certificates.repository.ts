import type { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../../shared/infra/database/prisma';

const certificateInclude = {
  submission: {
    include: {
      event: true,
      author: { select: { id: true, name: true, email: true } },
      coauthors: true,
    },
  },
} satisfies Prisma.CertificateInclude;

export type CertificateDetails = Prisma.CertificateGetPayload<{ include: typeof certificateInclude }>;

export const certificatesRepository = {
  create(data: { submissionId: string; storageKey: string; verificationCode: string }, db: DbClient = prisma) {
    return db.certificate.create({ data });
  },

  findById(id: string, db: DbClient = prisma) {
    return db.certificate.findUnique({ where: { id }, include: certificateInclude });
  },

  findBySubmission(submissionId: string, db: DbClient = prisma) {
    return db.certificate.findUnique({ where: { submissionId } });
  },

  findByCode(verificationCode: string, db: DbClient = prisma) {
    return db.certificate.findUnique({ where: { verificationCode }, include: certificateInclude });
  },

  listByParticipant(user: { id: string; email: string }, db: DbClient = prisma) {
    return db.certificate.findMany({
      where: {
        submission: {
          OR: [
            { authorId: user.id },
            { coauthors: { some: { OR: [{ userId: user.id }, { email: user.email.toLowerCase() }] } } },
          ],
        },
      },
      include: certificateInclude,
      orderBy: { issuedAt: 'desc' },
    });
  },
};
