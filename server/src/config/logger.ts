import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: ['req.headers.cookie', 'req.headers.authorization', 'password', 'passwordHash', 'token'],
});
