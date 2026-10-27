import { Router } from 'express';
import { authenticate } from '../../shared/http/middlewares/authenticate';
import { authorize } from '../../shared/http/middlewares/authorize';
import { reviewsController } from './reviews.controller';

export const reviewsRoutes = Router();

// organizador
reviewsRoutes.post(
  '/submissions/:submissionId/reviewers',
  authenticate,
  authorize('ORGANIZER'),
  reviewsController.assign,
);
reviewsRoutes.delete(
  '/submissions/:submissionId/reviewers/:reviewerId',
  authenticate,
  authorize('ORGANIZER'),
  reviewsController.unassign,
);
reviewsRoutes.post('/events/:eventId/results/publish', authenticate, authorize('ORGANIZER'), reviewsController.publishResults);

// avaliador
reviewsRoutes.get('/reviews/assigned', authenticate, authorize('REVIEWER'), reviewsController.listAssigned);
reviewsRoutes.put('/reviews/:id', authenticate, authorize('REVIEWER'), reviewsController.submit);
