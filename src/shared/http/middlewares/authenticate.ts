import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../infra/database/prisma';
import { verifyAccessToken, type AccessTokenClaims } from '../../utils/jwt';
import { UnauthorizedError } from '../errors';
import type { AuthUser } from '../types';

/**
 * Valida o Bearer token e carrega o usuário do banco a cada requisição,
 * para que mudanças de papel (ou remoção) tenham efeito imediato. Tokens revogados
 * no logout são recusados mesmo antes de expirar.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const [scheme, token] = header?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) throw new UnauthorizedError('Token não informado');

  let claims: AccessTokenClaims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError('Token inválido ou expirado');
  }

  const [user, revoked] = await Promise.all([
    prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, name: true, email: true, roles: true },
    }),
    prisma.revokedToken.count({ where: { jti: claims.jti } }),
  ]);
  if (revoked > 0) throw new UnauthorizedError('Sessão encerrada; faça login novamente');
  if (!user) throw new UnauthorizedError('Usuário não existe mais');

  req.user = user;
  req.token = claims;
  next();
}

/** Para controllers atrás de `authenticate` */
export function currentToken(req: Request): AccessTokenClaims {
  if (!req.token) throw new UnauthorizedError();
  return req.token;
}

/** Para controllers atrás de `authenticate` */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}
