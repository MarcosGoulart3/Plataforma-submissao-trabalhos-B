import { Router } from 'express';
import { authenticate } from '../../shared/http/middlewares/authenticate';
import { certificatesController } from './certificates.controller';

export const certificatesRoutes = Router();

certificatesRoutes.get('/certificates/mine', authenticate, certificatesController.listMine);
certificatesRoutes.get('/certificates/verify/:code', certificatesController.verify); // público
certificatesRoutes.get('/certificates/:id/download', authenticate, certificatesController.download);
