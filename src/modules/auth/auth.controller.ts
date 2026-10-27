import type { Request, Response } from 'express';
import { currentToken, currentUser } from '../../shared/http/middlewares/authenticate';
import { loginSchema, registerSchema } from './auth.schemas';
import { authService } from './auth.service';

export const authController = {
  async register(req: Request, res: Response) {
    const input = registerSchema.parse(req.body);
    res.status(201).json(await authService.register(input));
  },

  async login(req: Request, res: Response) {
    const input = loginSchema.parse(req.body);
    res.json(await authService.login(input));
  },

  async logout(req: Request, res: Response) {
    await authService.logout(currentToken(req));
    res.status(204).end();
  },

  me(req: Request, res: Response) {
    res.json(currentUser(req));
  },
};
