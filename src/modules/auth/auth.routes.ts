import { Router } from 'express';
import { authenticate } from '../../shared/http/middlewares/authenticate';
import { authController } from './auth.controller';

export const authRoutes = Router();

authRoutes.post('/auth/register', authController.register);
authRoutes.post('/auth/login', authController.login);
authRoutes.post('/auth/logout', authenticate, authController.logout);
authRoutes.get('/auth/me', authenticate, authController.me);
