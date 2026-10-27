import { Router } from 'express';
import { authenticate } from '../../shared/http/middlewares/authenticate';
import { authorize } from '../../shared/http/middlewares/authorize';
import { reportsController } from './reports.controller';

export const reportsRoutes = Router();

reportsRoutes.get('/events/:eventId/dashboard', authenticate, authorize('ORGANIZER'), reportsController.dashboard);
