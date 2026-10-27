import { Router } from 'express';
import { authenticate } from '../../shared/http/middlewares/authenticate';
import { authorize } from '../../shared/http/middlewares/authorize';
import { eventsController } from './events.controller';

export const eventsRoutes = Router();

eventsRoutes.get('/events', authenticate, eventsController.list);
eventsRoutes.get('/events/:id', authenticate, eventsController.get);
eventsRoutes.post('/events', authenticate, authorize('ORGANIZER'), eventsController.create);
eventsRoutes.patch('/events/:id', authenticate, authorize('ORGANIZER'), eventsController.update);
eventsRoutes.delete('/events/:id', authenticate, authorize('ORGANIZER'), eventsController.remove);
