import type { Prisma, SubmissionStatus } from '@prisma/client';
import { prisma, type DbClient } from '../../shared/infra/database/prisma';

export const submissionDetailsInclude = {
  event: true,
  author: { select: { id: true, name: true, email: true } },
  coauthors: { orderBy: { name: 'asc' } },
  reviews: {
    include: { reviewer: { select: { id: true, name: true, email: true } } },
    orderBy: { assignedAt: 'asc' },
  },
} satisfies Prisma.SubmissionInclude;

export type SubmissionDetails = Prisma.SubmissionGetPayload<{ include: typeof submissionDetailsInclude }>;

type CoauthorRow = { name: string; email: string; userId: string | null };

export const submissionsRepository = {
  create(
    data: Omit<Prisma.SubmissionUncheckedCreateInput, 'coauthors'> & { coauthors: CoauthorRow[] },
    db: DbClient = prisma,
  ) {
    const { coauthors, ...submission } = data;
    return db.submission.create({
      data: { ...submission, coauthors: { create: coauthors } },
      include: submissionDetailsInclude,
    });
  },

  findById(id: string, db: DbClient = prisma) {
    return db.submission.findUnique({ where: { id }, include: submissionDetailsInclude });
  },

  /** Submissões em que o usuário é autor ou coautor */
  listByParticipant(user: { id: string; email: string }, db: DbClient = prisma) {
    return db.submission.findMany({
      where: {
        OR: [
          { authorId: user.id },
          { coauthors: { some: { OR: [{ userId: user.id }, { email: user.email.toLowerCase() }] } } },
        ],
      },
      include: submissionDetailsInclude,
      orderBy: { createdAt: 'desc' },
    });
  },

  listByEvent(eventId: string, filter: { status?: SubmissionStatus; area?: string }, db: DbClient = prisma) {
    return db.submission.findMany({
      where: { eventId, status: filter.status, area: filter.area },
      include: submissionDetailsInclude,
      orderBy: { createdAt: 'asc' },
    });
  },

  /** Atualiza dados e, se informado, substitui a lista de coautores */
  update(
    id: string,
    data: Prisma.SubmissionUncheckedUpdateInput,
    coauthors: CoauthorRow[] | undefined,
    db: DbClient = prisma,
  ) {
    return db.submission.update({
      where: { id },
      data: {
        ...data,
        ...(coauthors && { coauthors: { deleteMany: {}, create: coauthors } }),
      },
      include: submissionDetailsInclude,
    });
  },

  updateStatus(id: string, status: SubmissionStatus, finalGrade: number | null | undefined, db: DbClient = prisma) {
    return db.submission.update({
      where: { id },
      data: { status, ...(finalGrade !== undefined && { finalGrade }) },
    });
  },
};
