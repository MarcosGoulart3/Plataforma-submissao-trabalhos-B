import bcrypt from 'bcryptjs';
import { ConflictError, TooManyRequestsError, UnauthorizedError } from '../../shared/http/errors';
import { signAccessToken, verifyAccessToken } from '../../shared/utils/jwt';
import { usersRepository } from '../users/users.repository';
import { registerSchema } from './auth.schemas';
import { authService, LOGIN_LOCK_MS, MAX_FAILED_LOGINS } from './auth.service';
import { loginAttemptsRepository } from './login-attempts.repository';
import { revokedTokensRepository } from './revoked-tokens.repository';

vi.mock('../../shared/infra/database/prisma', () => ({
  prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({}) },
}));

vi.mock('../users/users.repository', () => ({
  usersRepository: {
    findByEmail: vi.fn(),
    create: vi.fn(),
    linkCoauthorships: vi.fn(),
  },
}));

vi.mock('./login-attempts.repository', () => ({
  loginAttemptsRepository: {
    find: vi.fn(),
    increment: vi.fn(),
    restart: vi.fn(),
    lock: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('./revoked-tokens.repository', () => ({
  revokedTokensRepository: { revoke: vi.fn() },
}));

const repo = vi.mocked(usersRepository);
const attempts = vi.mocked(loginAttemptsRepository);

const publicUser = {
  id: '6f0e7a4e-5a0b-4b4f-9a39-2f6f9d8f1c11',
  name: 'Ana Autora',
  email: 'ana@furg.br',
  roles: ['PARTICIPANT' as const],
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  attempts.find.mockResolvedValue(null);
  attempts.increment.mockResolvedValue(attempt({ failures: 1 }));
});

function attempt(fields: Partial<{ failures: number; windowStartsAt: Date; lockedUntil: Date | null }>) {
  return { email: 'ana@furg.br', failures: 1, windowStartsAt: new Date(), lockedUntil: null, ...fields };
}

describe('auth.schemas', () => {
  it('normaliza o e-mail', () => {
    const parsed = registerSchema.parse({ name: 'Ana Autora', email: '  ANA@Furg.BR ', password: '12345678' });
    expect(parsed.email).toBe('ana@furg.br');
  });

  it('rejeita senha curta', () => {
    expect(registerSchema.safeParse({ name: 'Ana', email: 'a@b.com', password: '123' }).success).toBe(false);
  });
});

describe('authService.register', () => {
  it('cria o usuário com hash, vincula coautorias e devolve token', async () => {
    repo.findByEmail.mockResolvedValue(null);
    repo.create.mockResolvedValue(publicUser);

    const result = await authService.register({ name: 'Ana Autora', email: 'ana@furg.br', password: 'segredo123' });

    const createArgs = repo.create.mock.calls[0][0];
    expect(createArgs.passwordHash).not.toBe('segredo123');
    expect(await bcrypt.compare('segredo123', createArgs.passwordHash)).toBe(true);
    expect(repo.linkCoauthorships).toHaveBeenCalledWith(publicUser.id, publicUser.email, expect.anything());
    expect(verifyAccessToken(result.accessToken).sub).toBe(publicUser.id);
  });

  it('impede e-mail duplicado', async () => {
    repo.findByEmail.mockResolvedValue({ ...publicUser, passwordHash: 'x', updatedAt: new Date() });
    await expect(
      authService.register({ name: 'Ana Autora', email: 'ana@furg.br', password: 'segredo123' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('authService.login', () => {
  it('autentica com a senha correta', async () => {
    const passwordHash = await bcrypt.hash('segredo123', 4);
    repo.findByEmail.mockResolvedValue({ ...publicUser, passwordHash, updatedAt: new Date() });

    const result = await authService.login({ email: 'ana@furg.br', password: 'segredo123' });

    expect(result.user).not.toHaveProperty('passwordHash');
    expect(verifyAccessToken(result.accessToken).sub).toBe(publicUser.id);
  });

  it('rejeita senha errada e e-mail inexistente com o mesmo erro', async () => {
    const passwordHash = await bcrypt.hash('segredo123', 4);
    repo.findByEmail.mockResolvedValueOnce({ ...publicUser, passwordHash, updatedAt: new Date() });
    await expect(authService.login({ email: 'ana@furg.br', password: 'errada' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    repo.findByEmail.mockResolvedValueOnce(null);
    await expect(authService.login({ email: 'x@furg.br', password: 'errada' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('authService.login: bloqueio por tentativas', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it('conta a falha, inclusive de e-mail inexistente', async () => {
    repo.findByEmail.mockResolvedValue(null);
    attempts.increment.mockResolvedValue(attempt({ failures: 1 }));

    await expect(authService.login({ email: 'x@furg.br', password: 'errada' }, now)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(attempts.increment).toHaveBeenCalledWith('x@furg.br');
    expect(attempts.lock).not.toHaveBeenCalled();
  });

  it(`bloqueia por 15 min na ${MAX_FAILED_LOGINS}ª falha`, async () => {
    repo.findByEmail.mockResolvedValue(null);
    attempts.find.mockResolvedValue(attempt({ failures: MAX_FAILED_LOGINS - 1, windowStartsAt: minutesAgo(2) }));
    attempts.increment.mockResolvedValue(attempt({ failures: MAX_FAILED_LOGINS }));

    await expect(authService.login({ email: 'ana@furg.br', password: 'errada' }, now)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(attempts.lock).toHaveBeenCalledWith('ana@furg.br', new Date(now.getTime() + LOGIN_LOCK_MS));
  });

  it('recusa com 429 durante o bloqueio, mesmo com a senha correta', async () => {
    attempts.find.mockResolvedValue(attempt({ failures: 5, lockedUntil: new Date(now.getTime() + 60_000) }));

    const err = await authService.login({ email: 'ana@furg.br', password: 'segredo123' }, now).catch((e) => e);
    expect(err).toBeInstanceOf(TooManyRequestsError);
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe('Muitas tentativas. Tente novamente mais tarde.');
    expect(repo.findByEmail).not.toHaveBeenCalled();
  });

  it('recomeça a contagem quando a janela ou o bloqueio expiram', async () => {
    repo.findByEmail.mockResolvedValue(null);
    attempts.restart.mockResolvedValue(attempt({ failures: 1 }));

    attempts.find.mockResolvedValueOnce(attempt({ failures: 4, windowStartsAt: minutesAgo(20) }));
    await expect(authService.login({ email: 'ana@furg.br', password: 'errada' }, now)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    attempts.find.mockResolvedValueOnce(
      attempt({ failures: 5, windowStartsAt: minutesAgo(16), lockedUntil: minutesAgo(1) }),
    );
    await expect(authService.login({ email: 'ana@furg.br', password: 'errada' }, now)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(attempts.restart).toHaveBeenCalledTimes(2);
    expect(attempts.increment).not.toHaveBeenCalled();
    expect(attempts.lock).not.toHaveBeenCalled();
  });

  it('zera as falhas no login bem-sucedido', async () => {
    const passwordHash = await bcrypt.hash('segredo123', 4);
    repo.findByEmail.mockResolvedValue({ ...publicUser, passwordHash, updatedAt: new Date() });
    attempts.find.mockResolvedValue(attempt({ failures: 3 }));

    await authService.login({ email: 'ana@furg.br', password: 'segredo123' }, now);
    expect(attempts.clear).toHaveBeenCalledWith('ana@furg.br');
  });
});

describe('authService.logout', () => {
  it('revoga o token pelo jti até a expiração dele', async () => {
    const claims = verifyAccessToken(signAccessToken(publicUser.id));
    await authService.logout(claims);
    expect(revokedTokensRepository.revoke).toHaveBeenCalledWith(claims.jti, new Date(claims.exp * 1000));
  });

  it('cada token tem um jti próprio', () => {
    const first = verifyAccessToken(signAccessToken(publicUser.id));
    const second = verifyAccessToken(signAccessToken(publicUser.id));
    expect(first.jti).not.toBe(second.jti);
  });
});
