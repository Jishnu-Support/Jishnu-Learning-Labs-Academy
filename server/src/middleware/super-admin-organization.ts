import type { RequestHandler } from 'express';
import { OrganizationStatus, Role } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/http-error.js';

export const selectActiveOrganizationForSuperAdmin: RequestHandler = async (req, _res, next) => {
  if (req.auth?.role !== Role.SUPER_ADMIN) return next(new HttpError(403, 'Super Admin access is required'));
  const organizationId = req.params.organizationId;
  if (typeof organizationId !== 'string') return next(new HttpError(400, 'Organization ID is required'));
  try {
    const organization = await prisma.organization.findFirst({
      where: {
        id: organizationId,
        status: { in: [OrganizationStatus.ACTIVE, OrganizationStatus.APPROVED] },
      },
      select: { id: true },
    });
    if (!organization) return next(new HttpError(404, 'Active organization not found'));
    req.auth = { ...req.auth, organizationId: organization.id };
    return next();
  } catch (error) {
    return next(error);
  }
};
