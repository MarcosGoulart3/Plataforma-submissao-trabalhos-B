import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { authRoutes } from './modules/auth/auth.routes';
import { certificatesRoutes } from './modules/certificates/certificates.routes';
import { eventsRoutes } from './modules/events/events.routes';
import { reportsRoutes } from './modules/reports/reports.routes';
import { reviewsRoutes } from './modules/reviews/reviews.routes';
import { submissionsRoutes } from './modules/submissions/submissions.routes';
import { usersRoutes } from './modules/users/users.routes';
import { errorHandler, notFoundHandler } from './shared/http/middlewares/error-handler';
import { prisma } from './shared/infra/database/prisma';
import { logger } from './shared/utils/logger';
import './shared/http/types';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  app.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });

  // Express 5 propaga erros de handlers async para o errorHandler automaticamente
  app.use(authRoutes);
  app.use(usersRoutes);
  app.use(eventsRoutes);
  app.use(submissionsRoutes);
  app.use(reviewsRoutes);
  app.use(certificatesRoutes);
  app.use(reportsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
