import type { Request, Response } from 'express';
import { currentUser } from '../../shared/http/middlewares/authenticate';
import {
  assignReviewersSchema,
  eventIdParamsSchema,
  publishResultsSchema,
  reviewIdParamsSchema,
  submissionIdParamsSchema,
  submitReviewSchema,
  unassignParamsSchema,
} from './reviews.schemas';
import { reviewsService } from './reviews.service';

export const reviewsController = {
  async assign(req: Request, res: Response) {
    const { submissionId } = submissionIdParamsSchema.parse(req.params);
    const { reviewerIds } = assignReviewersSchema.parse(req.body);
    res.json(await reviewsService.assignReviewers(currentUser(req), submissionId, reviewerIds));
  },

  async unassign(req: Request, res: Response) {
    const { submissionId, reviewerId } = unassignParamsSchema.parse(req.params);
    await reviewsService.unassignReviewer(currentUser(req), submissionId, reviewerId);
    res.status(204).end();
  },

  async listAssigned(req: Request, res: Response) {
    res.json(await reviewsService.listAssigned(currentUser(req)));
  },

  async submit(req: Request, res: Response) {
    const { id } = reviewIdParamsSchema.parse(req.params);
    const input = submitReviewSchema.parse(req.body);
    res.json(await reviewsService.submitReview(currentUser(req), id, input));
  },

  async publishResults(req: Request, res: Response) {
    const { eventId } = eventIdParamsSchema.parse(req.params);
    const options = publishResultsSchema.parse(req.body ?? {});
    res.json(await reviewsService.publishResults(currentUser(req), eventId, options));
  },
};
