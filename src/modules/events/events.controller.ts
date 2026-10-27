import type { Request, Response } from 'express';
import { currentUser } from '../../shared/http/middlewares/authenticate';
import { createEventSchema, eventIdParamsSchema, updateEventSchema } from './events.schemas';
import { eventsService } from './events.service';

export const eventsController = {
  async create(req: Request, res: Response) {
    const input = createEventSchema.parse(req.body);
    res.status(201).json(await eventsService.create(currentUser(req), input));
  },

  async list(_req: Request, res: Response) {
    res.json(await eventsService.list());
  },

  async get(req: Request, res: Response) {
    const { id } = eventIdParamsSchema.parse(req.params);
    res.json(await eventsService.get(id));
  },

  async update(req: Request, res: Response) {
    const { id } = eventIdParamsSchema.parse(req.params);
    const input = updateEventSchema.parse(req.body);
    res.json(await eventsService.update(currentUser(req), id, input));
  },

  async remove(req: Request, res: Response) {
    const { id } = eventIdParamsSchema.parse(req.params);
    await eventsService.remove(currentUser(req), id);
    res.status(204).end();
  },
};
