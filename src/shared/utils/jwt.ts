import { randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenClaims {
  sub: string;
  /** Identificador único do token, usado para revogá-lo no logout */
  jti: string;
  /** Expiração em segundos desde a época (padrão JWT) */
  exp: number;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, {
    subject: userId,
    jwtid: randomUUID(),
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

/** Lança erro do jsonwebtoken se o token for inválido ou expirado */
export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || !decoded.sub) throw new Error('Token sem subject');
  // tokens sem jti não poderiam ser revogados no logout
  if (!decoded.jti || !decoded.exp) throw new Error('Token sem jti ou exp');
  return { sub: decoded.sub, jti: decoded.jti, exp: decoded.exp };
}
