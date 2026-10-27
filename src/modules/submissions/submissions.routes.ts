import { Router } from 'express';
import { authenticate } from '../../shared/http/middlewares/authenticate';
import { authorize } from '../../shared/http/middlewares/authorize';
import { uploadPdf } from '../../shared/http/middlewares/upload';
import { submissionsController } from './submissions.controller';

export const submissionsRoutes = Router();

submissionsRoutes.post('/events/:eventId/submissions', authenticate, uploadPdf('file'), submissionsController.create);
submissionsRoutes.get(
  '/events/:eventId/submissions',
  authenticate,
  authorize('ORGANIZER'),
  submissionsController.listByEvent,
);

submissionsRoutes.get('/submissions/mine', authenticate, submissionsController.listMine);
submissionsRoutes.get('/submissions/:id', authenticate, submissionsController.get);
submissionsRoutes.patch('/submissions/:id', authenticate, uploadPdf('file'), submissionsController.update);
submissionsRoutes.get('/submissions/:id/file', authenticate, submissionsController.download);
