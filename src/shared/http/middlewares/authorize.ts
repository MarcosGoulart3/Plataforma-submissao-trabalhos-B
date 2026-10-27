import type { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors';
import type { AuthUser } from '../types';

export function hasRole(user: Pick<AuthUser, 'roles'>, ...roles: Role[]): boolean {
  // administrador tem acesso a tudo
  return user.roles.includes('ADMIN') || roles.some((role) => user.roles.includes(role));
}

/**
 * Autorização por PAPEL (grosso). A autorização por RECURSO
 * (ex.: "é o autor desta submissão?") fica nas policies de cada módulo.
 */
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedError();
    if (!hasRole(req.user, ...roles)) {
      throw new ForbiddenError(`Requer um dos papéis: ${roles.join(', ')}`);
    }
    next();
  };
}
