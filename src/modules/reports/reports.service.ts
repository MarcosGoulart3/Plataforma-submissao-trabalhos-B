import type { AuthUser } from '../../shared/http/types';
import { assertCanManageEvent } from '../events/event.policy';
import { eventsService } from '../events/events.service';
import { approvalRate, round2 } from './metrics';
import { reportsRepository } from './reports.repository';

export const reportsService = {
  async dashboard(user: AuthUser, eventId: string) {
    const event = await eventsService.getOrFail(eventId);
    assertCanManageEvent(user, event);

    const [byStatus, areaRows, reviews, averageGrade] = await Promise.all([
      reportsRepository.countByStatus(eventId),
      reportsRepository.byArea(eventId),
      reportsRepository.reviewStats(eventId),
      reportsRepository.averageFinalGrade(eventId),
    ]);

    // inclui áreas do evento que ainda não receberam submissões
    const rowsByArea = new Map(areaRows.map((row) => [row.area, row]));
    const areas = [...new Set([...event.areas, ...rowsByArea.keys()])].map((area) => {
      const row = rowsByArea.get(area);
      const approved = row?.approved ?? 0;
      const rejected = row?.rejected ?? 0;
      return {
        area,
        submissions: row?.total ?? 0,
        approved,
        rejected,
        approvalRate: approvalRate(approved, rejected),
        averageGrade: round2(row?.average_grade ?? null),
      };
    });

    const total = Object.values(byStatus).reduce((acc, n) => acc + n, 0);

    return {
      event: { id: event.id, name: event.name, resultsPublishedAt: event.resultsPublishedAt },
      submissions: { total, byStatus },
      approvalRate: approvalRate(byStatus.APPROVED, byStatus.REJECTED),
      averageFinalGrade: round2(averageGrade),
      byArea: areas,
      reviews: { ...reviews, pending: reviews.assigned - reviews.completed },
    };
  },
};
