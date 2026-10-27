import { execSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { env } from '../src/shared/config/env';
import { prisma } from '../src/shared/infra/database/prisma';
import { signAccessToken } from '../src/shared/utils/jwt';

export const DAY = 24 * 60 * 60 * 1000;

/** Aplica as migrations no banco de teste e limpa tudo (inclusive a fila) */
export async function resetDatabase() {
  execSync('npx prisma migrate deploy', { env: { ...process.env }, stdio: 'ignore' });
  await prisma.$executeRawUnsafe(
    'TRUNCATE certificates, reviews, submission_coauthors, submissions, events, addresses, users, login_attempts, revoked_tokens CASCADE',
  );
  const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT to_regclass('${env.PGBOSS_SCHEMA}.job') IS NOT NULL AS exists`,
  );
  if (exists) await prisma.$executeRawUnsafe(`DELETE FROM ${env.PGBOSS_SCHEMA}.job`);
}

export async function createUser(name: string, email: string, roles: Role[]) {
  const user = await prisma.user.create({
    data: { name, email, roles, passwordHash: await bcrypt.hash('senha12345', 4) },
  });
  return { ...user, token: signAccessToken(user.id) };
}

export interface QueuedJob {
  name: string;
  data: Record<string, unknown>;
}

export function queuedJobs(name?: string) {
  return prisma.$queryRawUnsafe<QueuedJob[]>(
    `SELECT name, data FROM ${env.PGBOSS_SCHEMA}.job WHERE ($1::text IS NULL OR name = $1) ORDER BY created_on`,
    name ?? null,
  );
}

/** Janelas do evento relativas a "agora", para simular cada fase */
export function timeline(phase: 'submission' | 'review' | 'finished') {
  const now = Date.now();
  const offset = { submission: 0, review: -15 * DAY, finished: -40 * DAY }[phase];
  const at = (days: number) => new Date(now + offset + days * DAY);
  return {
    submissionStartsAt: at(-1),
    submissionEndsAt: at(10),
    reviewStartsAt: at(10),
    reviewEndsAt: at(30),
    resultAt: at(31),
  };
}

export function fakePdf(sizeBytes = 2048): Buffer {
  const header = Buffer.from('%PDF-1.4\n');
  return Buffer.concat([header, Buffer.alloc(Math.max(0, sizeBytes - header.length), 0x20)]);
}
