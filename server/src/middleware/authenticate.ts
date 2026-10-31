import type { RequestHandler } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { verifyAccessToken } from '../utils/tokens.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.accessToken as string | undefined;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  let claims: ReturnType<typeof verifyAccessToken>;
  try {
    claims = verifyAccessToken(token);
  } catch {
    return next(new HttpError(401, 'Invalid or expired access token'));
  }
  try {
    const session = await prisma.session.findUnique({ where: { id: claims.sid }, include: { user: true } });
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) {
      return next(new HttpError(401, 'Session expired. Please sign in again.'));
    }
    req.auth = { userId: session.userId, role: session.user.role, sessionId: session.id };
    return next();
  } catch {
    return next(new HttpError(500, 'Unable to verify your session'));
  }
};

export function requireRoles(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new HttpError(401, 'Authentication required'));
    if (!roles.includes(req.auth.role)) return next(new HttpError(403, 'You do not have permission to perform this action'));
    return next();
  };
}

export const requireInstructor = requireRoles(Role.INSTRUCTOR);
