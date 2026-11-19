import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { startMediaWorker } from './modules/media/media.worker.js';
import { startLearningWorker } from './modules/learning/learning.worker.js';
import { startNotificationScheduler } from './modules/notifications/notifications.scheduler.js';
import { assertPaymentProviderAllowed } from './modules/payments/payment.provider.js';
import { attachLiveClassSignaling } from './modules/student-portal/live-class-signaling.js';

assertPaymentProviderAllowed();
const server = createServer(app);
const stopLiveClassSignaling = attachLiveClassSignaling(server);
server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API server listening'));
server.headersTimeout = 2 * 60 * 1000;
server.requestTimeout = 60 * 60 * 1000;
const stopMediaWorker = startMediaWorker();
const stopLearningWorker = startLearningWorker();
const stopNotificationScheduler = startNotificationScheduler();

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down API server');
  stopMediaWorker();
  stopLearningWorker();
  stopNotificationScheduler();
  stopLiveClassSignaling();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
