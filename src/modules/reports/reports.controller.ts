import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../../shared/http/middlewares/authenticate';
import { reportsService } from './reports.service';

const params = z.object({ eventId: z.uuid() });

export const reportsController = {
  async dashboard(req: Request, res: Response) {
    const { eventId } = params.parse(req.params);
    res.json(await reportsService.dashboard(currentUser(req), eventId));
  },
};
