import { createApp } from './app';
import { env } from './shared/config/env';
import { prisma } from './shared/infra/database/prisma';
import { startBoss, stopBoss } from './shared/infra/queue/boss';
import { logger } from './shared/utils/logger';

async function main() {
  // a API só produz jobs; a supervisão da fila fica com o worker
  await startBoss({ supervise: false });

  const server = createApp().listen(env.PORT, () => {
    logger.info(`API ouvindo em http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Encerrando API...');
    server.close(async () => {
      await stopBoss();
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Falha ao iniciar a API');
  process.exit(1);
});
