import type { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../../shared/infra/database/prisma';

const reviewWithSubmission = {
  submission: { include: { event: true, coauthors: true } },
} satisfies Prisma.ReviewInclude;

export const reviewsRepository = {
  createMany(submissionId: string, reviewerIds: string[], db: DbClient = prisma) {
    return db.review.createMany({
      data: reviewerIds.map((reviewerId) => ({ submissionId, reviewerId })),
      skipDuplicates: true,
    });
  },

  findById(id: string, db: DbClient = prisma) {
    return db.review.findUnique({ where: { id }, include: reviewWithSubmission });
  },

  findAssignment(submissionId: string, reviewerId: string, db: DbClient = prisma) {
    return db.review.findUnique({ where: { submissionId_reviewerId: { submissionId, reviewerId } } });
  },

  delete(id: string, db: DbClient = prisma) {
    return db.review.delete({ where: { id } });
  },

  listByReviewer(reviewerId: string, db: DbClient = prisma) {
    return db.review.findMany({
      where: { reviewerId },
      include: reviewWithSubmission,
      orderBy: { assignedAt: 'desc' },
    });
  },

  submit(id: string, data: { grade: number; comments: string }, db: DbClient = prisma) {
    return db.review.update({ where: { id }, data: { ...data, submittedAt: new Date() } });
  },

  /** Todas as atribuições do trabalho, concluídas ou não */
  gradesBySubmission(submissionId: string, db: DbClient = prisma) {
    return db.review.findMany({
      where: { submissionId },
      select: { grade: true, submittedAt: true },
    });
  },
};
