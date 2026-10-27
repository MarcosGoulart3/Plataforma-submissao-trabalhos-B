import type { Request, Response } from 'express';
import { currentUser } from '../../shared/http/middlewares/authenticate';
import { sendPdf } from '../../shared/http/send-file';
import {
  createSubmissionSchema,
  eventIdParamsSchema,
  listEventSubmissionsQuerySchema,
  submissionIdParamsSchema,
  updateSubmissionSchema,
} from './submissions.schemas';
import { submissionsService } from './submissions.service';

export const submissionsController = {
  async create(req: Request, res: Response) {
    const { eventId } = eventIdParamsSchema.parse(req.params);
    const input = createSubmissionSchema.parse(req.body);
    res.status(201).json(await submissionsService.create(currentUser(req), eventId, input, req.file));
  },

  async update(req: Request, res: Response) {
    const { id } = submissionIdParamsSchema.parse(req.params);
    const input = updateSubmissionSchema.parse(req.body ?? {});
    res.json(await submissionsService.update(currentUser(req), id, input, req.file));
  },

  async get(req: Request, res: Response) {
    const { id } = submissionIdParamsSchema.parse(req.params);
    res.json(await submissionsService.get(currentUser(req), id));
  },

  async listMine(req: Request, res: Response) {
    res.json(await submissionsService.listMine(currentUser(req)));
  },

  async listByEvent(req: Request, res: Response) {
    const { eventId } = eventIdParamsSchema.parse(req.params);
    const filter = listEventSubmissionsQuerySchema.parse(req.query);
    res.json(await submissionsService.listByEvent(currentUser(req), eventId, filter));
  },

  async download(req: Request, res: Response) {
    const { id } = submissionIdParamsSchema.parse(req.params);
    const { stream, fileName } = await submissionsService.openFile(currentUser(req), id);
    await sendPdf(res, stream, fileName);
  },
};
