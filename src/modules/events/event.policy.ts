import { ForbiddenError } from '../../shared/http/errors';
import { hasRole } from '../../shared/http/middlewares/authorize';
import type { AuthUser } from '../../shared/http/types';

/** Só o organizador dono do evento (ou um administrador) gerencia o evento */
export function canManageEvent(user: AuthUser, event: { organizerId: string }): boolean {
  return user.roles.includes('ADMIN') || (hasRole(user, 'ORGANIZER') && event.organizerId === user.id);
}

export function assertCanManageEvent(user: AuthUser, event: { organizerId: string }): void {
  if (!canManageEvent(user, event)) {
    throw new ForbiddenError('Apenas o organizador responsável pelo evento pode realizar esta ação');
  }
}
