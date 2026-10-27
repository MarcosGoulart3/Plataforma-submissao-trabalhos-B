import type { Role } from '@prisma/client';
import type { AccessTokenClaims } from '../utils/jwt';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: Role[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Claims do token da requisição (preenchido por `authenticate`) */
      token?: AccessTokenClaims;
    }
  }
}
