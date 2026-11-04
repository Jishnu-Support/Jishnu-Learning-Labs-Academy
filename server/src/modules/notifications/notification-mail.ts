import { logger } from '../../config/logger.js';

export type NotificationEmail = {
  to: string;
  subject: string;
  text: string;
};

export interface NotificationMailProvider {
  send(message: NotificationEmail): Promise<void>;
}

class DisabledNotificationMailProvider implements NotificationMailProvider {
  async send(): Promise<void> {
    throw new Error('Notification email delivery is disabled');
  }
}

class ConsoleNotificationMailProvider implements NotificationMailProvider {
  async send(message: NotificationEmail) {
    logger.info({ to: message.to, subject: message.subject }, 'Development notification email');
  }
}

export function createNotificationMailProvider(enabled = false, environment = process.env.NODE_ENV): NotificationMailProvider {
  if (!enabled) return new DisabledNotificationMailProvider();
  if (environment !== 'development') {
    throw new Error('Notification email is not enabled outside development; real email delivery requires separate approval.');
  }
  return new ConsoleNotificationMailProvider();
}
