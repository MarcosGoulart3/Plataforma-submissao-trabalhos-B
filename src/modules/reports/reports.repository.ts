import type { SubmissionStatus } from '@prisma/client';
import { prisma, type DbClient } from '../../shared/infra/database/prisma';

export interface AreaRow {
  area: string;
  total: number;
  approved: number;
  rejected: number;
  average_grade: number | null;
}

export interface ReviewRow {
  assigned: number;
  completed: number;
  reviewers: number;
}

/** Consultas agregadas: o banco faz a contagem, não a aplicação */
export const reportsRepository = {
  async countByStatus(eventId: string, db: DbClient = prisma): Promise<Record<SubmissionStatus, number>> {
    const rows = await db.submission.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true } });
    const counts: Record<SubmissionStatus, number> = { SUBMITTED: 0, UNDER_REVIEW: 0, APPROVED: 0, REJECTED: 0 };
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
  },

  byArea(eventId: string, db: DbClient = prisma) {
    return db.$queryRaw<AreaRow[]>`
      SELECT area,
             COUNT(*)::int                                     AS total,
             COUNT(*) FILTER (WHERE status = 'APPROVED')::int  AS approved,
             COUNT(*) FILTER (WHERE status = 'REJECTED')::int  AS rejected,
             AVG(final_grade)::float                           AS average_grade
        FROM submissions
       WHERE event_id = ${eventId}::uuid
       GROUP BY area
       ORDER BY area`;
  },

  async reviewStats(eventId: string, db: DbClient = prisma): Promise<ReviewRow> {
    const [row] = await db.$queryRaw<ReviewRow[]>`
      SELECT COUNT(*)::int                     AS assigned,
             COUNT(r.submitted_at)::int        AS completed,
             COUNT(DISTINCT r.reviewer_id)::int AS reviewers
        FROM reviews r
        JOIN submissions s ON s.id = r.submission_id
       WHERE s.event_id = ${eventId}::uuid`;
    return row;
  },

  async averageFinalGrade(eventId: string, db: DbClient = prisma): Promise<number | null> {
    const result = await db.submission.aggregate({ where: { eventId }, _avg: { finalGrade: true } });
    return result._avg.finalGrade === null ? null : Number(result._avg.finalGrade);
  },
};
