import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { HttpError } from '../utils/http-error.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  void next;
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        message: 'Invalid request',
        details: error.issues.map(({ code, path, message }) => ({ code, path, message })),
      },
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  logger.error({ err: error }, 'Unhandled request error');
  res.status(500).json({ error: { message: 'Internal server error' } });
};
