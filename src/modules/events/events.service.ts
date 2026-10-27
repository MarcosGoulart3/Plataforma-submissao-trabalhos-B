import type { Event } from '@prisma/client';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/http/errors';
import type { AuthUser } from '../../shared/http/types';
import { toNumber } from '../../shared/utils/decimal';
import { deadlineStatus, validateTimeline } from './deadline.policy';
import { assertCanManageEvent } from './event.policy';
import type { CreateEventInput, UpdateEventInput } from './events.schemas';
import { eventsRepository } from './events.repository';

export function toEventResponse(event: Event, now = new Date()) {
  return {
    ...event,
    approvalThreshold: toNumber(event.approvalThreshold),
    deadlines: deadlineStatus(event, now),
  };
}

export const eventsService = {
  async create(organizer: AuthUser, input: CreateEventInput) {
    const event = await eventsRepository.create({ ...input, organizerId: organizer.id });
    return toEventResponse(event);
  },

  async list() {
    const events = await eventsRepository.list();
    return events.map((event) => toEventResponse(event));
  },

  async getOrFail(id: string): Promise<Event> {
    const event = await eventsRepository.findById(id);
    if (!event) throw new NotFoundError('Evento');
    return event;
  },

  async get(id: string) {
    return toEventResponse(await this.getOrFail(id));
  },

  async update(user: AuthUser, id: string, input: UpdateEventInput) {
    const event = await this.getOrFail(id);
    assertCanManageEvent(user, event);

    if (event.resultsPublishedAt) {
      throw new BadRequestError('Resultados já publicados: o evento não pode mais ser alterado');
    }

    const merged = { ...event, ...input };
    const errors = validateTimeline(merged);
    if (errors.length > 0) throw new BadRequestError('Prazos inconsistentes', errors);

    return toEventResponse(await eventsRepository.update(id, input));
  },

  /** Só eventos sem submissões podem ser excluídos (trabalhos, avaliações e certificados dependem dele) */
  async remove(user: AuthUser, id: string) {
    const event = await this.getOrFail(id);
    assertCanManageEvent(user, event);

    const deleted = await eventsRepository.deleteIfEmpty(id);
    if (deleted.count === 0) throw new ConflictError('O evento possui submissões e não pode ser excluído');
  },
};
