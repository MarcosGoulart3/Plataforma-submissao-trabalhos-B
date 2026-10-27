import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { prisma } from './prisma';

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'senha12345';

async function upsertUser(name: string, email: string, roles: Role[], passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: { roles: { set: roles } },
    create: { name, email, roles, passwordHash },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  await upsertUser('Administrador', 'admin@grande.local', ['ADMIN'], passwordHash);
  const organizer = await upsertUser('Olga Organizadora', 'organizador@grande.local', ['ORGANIZER'], passwordHash);
  await upsertUser('Rui Revisor', 'avaliador1@grande.local', ['REVIEWER'], passwordHash);
  await upsertUser('Rita Revisora', 'avaliador2@grande.local', ['REVIEWER', 'PARTICIPANT'], passwordHash);
  await upsertUser('Ana Autora', 'autora@grande.local', ['PARTICIPANT'], passwordHash);

  const name = 'MEPERG — Mostra de Ensino, Pesquisa e Extensão';
  const existing = await prisma.event.findFirst({ where: { name } });
  if (!existing) {
    const now = Date.now();
    await prisma.event.create({
      data: {
        name,
        description: 'Evento de demonstração criado pelo seed',
        areas: ['Ciências Exatas', 'Ciências Humanas', 'Computação', 'Engenharias'],
        organizerId: organizer.id,
        submissionStartsAt: new Date(now - DAY),
        submissionEndsAt: new Date(now + 14 * DAY),
        reviewStartsAt: new Date(now + 14 * DAY),
        reviewEndsAt: new Date(now + 28 * DAY),
        resultAt: new Date(now + 30 * DAY),
        approvalThreshold: 6,
      },
    });
  }

  console.log(`Seed concluído. Usuários de teste (senha "${PASSWORD}"):`);
  console.log('  admin@grande.local, organizador@grande.local, avaliador1@grande.local,');
  console.log('  avaliador2@grande.local, autora@grande.local');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
