import type { ErrorRequestHandler } from 'express';
import { MulterError } from 'multer';
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
  if (error instanceof MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({
      error: { message: error.code === 'LIMIT_FILE_SIZE' ? 'Note files must be 20 MB or smaller' : 'Invalid note file upload' },
    });
    return;
  }
  logger.error({ err: error }, 'Unhandled request error');
  res.status(500).json({ error: { message: 'Internal server error' } });
};
