import type { Request, RequestHandler } from 'express';
import { AccountStatus, OrganizationStatus, Role } from '@prisma/client';
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
    const session = await prisma.session.findUnique({
      where: { id: claims.sid },
      include: { user: { include: { organization: true } } },
    });
    if (session?.user.organization?.status === OrganizationStatus.SUSPENDED) {
      return next(new HttpError(403, 'This organization is suspended. Contact the platform administrator.'));
    }
    if (session?.user.organization && session.user.organization.status !== OrganizationStatus.ACTIVE &&
      session.user.organization.status !== OrganizationStatus.APPROVED) {
      return next(new HttpError(403, 'This organization is not active.'));
    }
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive ||
      session.organizationId !== session.user.organizationId || claims.organizationId !== session.user.organizationId ||
      claims.role !== session.user.role || session.user.status !== AccountStatus.APPROVED) {
      return next(new HttpError(401, 'Session expired. Please sign in again.'));
    }
    if (
      session.user.mustChangePassword &&
      !['/me', '/logout', '/change-password'].includes(req.path)
    ) {
      return next(new HttpError(403, 'Change your temporary password before continuing'));
    }
    req.auth = {
      userId: session.userId,
      role: session.user.role,
      sessionId: session.id,
      organizationId: session.user.organizationId,
    };
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

export const requireOrganization: RequestHandler = (req, _res, next) => {
  if (!req.auth?.organizationId) return next(new HttpError(403, 'An organization-scoped account is required'));
  return next();
};

export function getOrganizationId(req: Request): string {
  if (!req.auth?.organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return req.auth.organizationId;
}
