import { logger } from '../../config/logger.js';
import { expireOverdueAttempts } from './learning.service.js';

const pollIntervalMs = 30_000;

export function startLearningWorker(): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void expireOverdueAttempts()
        .then((count) => {
          if (count) logger.info({ count }, 'Expired assessment attempts');
        })
        .catch((error: unknown) => logger.error({ err: error }, 'Assessment expiry worker failed'))
        .finally(schedule);
    }, pollIntervalMs);
  };

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
