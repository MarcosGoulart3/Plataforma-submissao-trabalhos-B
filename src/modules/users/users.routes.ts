import { Router } from 'express';
import { authenticate } from '../../shared/http/middlewares/authenticate';
import { authorize } from '../../shared/http/middlewares/authorize';
import { usersController } from './users.controller';

export const usersRoutes = Router();

usersRoutes.use('/users', authenticate);

usersRoutes.get('/users/me', usersController.me);
usersRoutes.patch('/users/me', usersController.updateMe);
usersRoutes.put('/users/me/address', usersController.saveAddress);
usersRoutes.get('/users/cep/:cep', usersController.lookupCep);

// organizador lista usuários para escolher avaliadores
usersRoutes.get('/users', authorize('ORGANIZER'), usersController.list);
usersRoutes.patch('/users/:id/roles', authorize('ADMIN'), usersController.updateRoles);
