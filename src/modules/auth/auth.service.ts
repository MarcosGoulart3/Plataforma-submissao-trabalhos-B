import type { LoginAttempt } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ConflictError, TooManyRequestsError, UnauthorizedError } from '../../shared/http/errors';
import { prisma } from '../../shared/infra/database/prisma';
import { signAccessToken, type AccessTokenClaims } from '../../shared/utils/jwt';
import { usersRepository, type PublicUser } from '../users/users.repository';
import type { LoginInput, RegisterInput } from './auth.schemas';
import { loginAttemptsRepository } from './login-attempts.repository';
import { revokedTokensRepository } from './revoked-tokens.repository';

const BCRYPT_COST = 10;

/** Após 5 falhas em 15 min, o e-mail fica bloqueado por 15 min */
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
}

export const authService = {
  /** Cadastro público sempre cria PARTICIPANT; outros papéis são concedidos por um administrador */
  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await usersRepository.findByEmail(input.email);
    if (existing) throw new ConflictError('E-mail já cadastrado');

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    const user = await prisma.$transaction(async (tx) => {
      const created = await usersRepository.create({ name: input.name, email: input.email, passwordHash }, tx);
      await usersRepository.linkCoauthorships(created.id, created.email, tx);
      return created;
    });

    return { user, accessToken: signAccessToken(user.id) };
  },

  async login(input: LoginInput, now = new Date()): Promise<AuthResult> {
    // o bloqueio vale também para a senha correta e para e-mails inexistentes
    const attempt = await loginAttemptsRepository.find(input.email);
    if (attempt?.lockedUntil && attempt.lockedUntil > now) {
      throw new TooManyRequestsError('Muitas tentativas. Tente novamente mais tarde.');
    }

    const user = await usersRepository.findByEmail(input.email);
    // mesma mensagem para e-mail inexistente e senha errada (não revela quais e-mails existem)
    const valid = user ? await bcrypt.compare(input.password, user.passwordHash) : false;
    if (!user || !valid) {
      await registerFailedLogin(input.email, attempt, now);
      throw new UnauthorizedError('E-mail ou senha inválidos');
    }

    if (attempt) await loginAttemptsRepository.clear(input.email);

    const { passwordHash: _ignored, updatedAt: _u, ...publicUser } = user;
    return { user: publicUser, accessToken: signAccessToken(user.id) };
  },

  /** Revoga o token atual até a expiração dele */
  async logout(token: AccessTokenClaims): Promise<void> {
    await revokedTokensRepository.revoke(token.jti, new Date(token.exp * 1000));
  },
};

/** Conta a falha; ao atingir o limite dentro da janela, bloqueia o e-mail */
async function registerFailedLogin(email: string, previous: LoginAttempt | null, now: Date) {
  // janela vencida ou bloqueio já cumprido: a contagem recomeça
  const expired =
    previous !== null &&
    (previous.lockedUntil !== null || now.getTime() - previous.windowStartsAt.getTime() >= LOGIN_LOCK_MS);

  const attempt = expired
    ? await loginAttemptsRepository.restart(email, now)
    : await loginAttemptsRepository.increment(email);

  if (attempt.failures >= MAX_FAILED_LOGINS) {
    await loginAttemptsRepository.lock(email, new Date(now.getTime() + LOGIN_LOCK_MS));
  }
}
