import type { Request, Response } from 'express';
import { currentUser } from '../../shared/http/middlewares/authenticate';
import {
  addressSchema,
  cepParamsSchema,
  listUsersQuerySchema,
  updateProfileSchema,
  updateRolesSchema,
  userIdParamsSchema,
} from './users.schemas';
import { usersService } from './users.service';

export const usersController = {
  async me(req: Request, res: Response) {
    res.json(await usersService.getProfile(currentUser(req).id));
  },

  async updateMe(req: Request, res: Response) {
    const input = updateProfileSchema.parse(req.body);
    res.json(await usersService.updateProfile(currentUser(req).id, input));
  },

  async saveAddress(req: Request, res: Response) {
    const input = addressSchema.parse(req.body);
    res.json(await usersService.saveAddress(currentUser(req).id, input));
  },

  async lookupCep(req: Request, res: Response) {
    const { cep } = cepParamsSchema.parse(req.params);
    res.json(await usersService.lookupCep(cep));
  },

  async list(req: Request, res: Response) {
    const filter = listUsersQuerySchema.parse(req.query);
    res.json(await usersService.list(filter));
  },

  async updateRoles(req: Request, res: Response) {
    const { id } = userIdParamsSchema.parse(req.params);
    const { roles } = updateRolesSchema.parse(req.body);
    res.json(await usersService.updateRoles(id, roles));
  },
};
