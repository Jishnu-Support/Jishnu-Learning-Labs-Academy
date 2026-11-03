import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { AccountStatus, OrganizationStatus, Role, type Prisma } from '@prisma/client';
import type { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { organizationRegistrationSchema } from './organizations.schemas.js';

type RegistrationInput = z.infer<typeof organizationRegistrationSchema>;

const organizationFields = {
  id: true,
  name: true,
  headName: true,
  contactNumber: true,
  email: true,
  address: true,
  city: true,
  state: true,
  country: true,
  registrationNumber: true,
  website: true,
  status: true,
  rejectionReason: true,
  code: true,
  createdAt: true,
} as const;

function makeCode(name: string): string {
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${slug || 'organization'}-${randomBytes(6).toString('hex')}`;
}

async function uniqueCode(tx: Prisma.TransactionClient, name: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeCode(name);
    if (!(await tx.organization.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new HttpError(503, 'Unable to generate an organization code. Please try again.');
}

export async function register(input: RegistrationInput, requireApproval = env.REQUIRE_ORG_APPROVAL) {
  const adminPasswordHash = await bcrypt.hash(input.password, 12);
  try {
    return await prisma.$transaction(async (tx) => {
      const code = requireApproval ? null : await uniqueCode(tx, input.organizationName);
      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          code,
          headName: input.organizationHeadName,
          contactNumber: input.contactNumber,
          email: input.email,
          address: input.address,
          city: input.city,
          state: input.state,
          country: input.country,
          registrationNumber: input.registrationNumber || null,
          website: input.website || null,
          status: requireApproval ? OrganizationStatus.PENDING : OrganizationStatus.ACTIVE,
          pendingAdminPasswordHash: requireApproval ? adminPasswordHash : null,
        },
        select: organizationFields,
      });
      let adminUserId: string | null = null;
      if (!requireApproval) {
        const admin = await tx.user.create({
          data: {
            organizationId: organization.id,
            email: input.email,
            name: input.organizationHeadName,
            phone: input.contactNumber,
            passwordHash: adminPasswordHash,
            role: Role.ORG_ADMIN,
            status: AccountStatus.APPROVED,
          },
          select: { id: true },
        });
        adminUserId = admin.id;
        await tx.auditLog.create({
          data: {
            organizationId: organization.id,
            action: 'ORG_ADMIN_ACCOUNT_CREATED',
            targetType: 'User',
            targetId: admin.id,
            metadata: { role: Role.ORG_ADMIN },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          action: 'ORGANIZATION_REGISTERED',
          targetType: 'Organization',
          targetId: organization.id,
          metadata: { status: organization.status, code },
        },
      });
      return { ...organization, adminUserId };
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new HttpError(409, 'An organization with this email is already registered');
    }
    throw error;
  }
}

export async function listOrganizations(search?: string) {
  const term = search?.trim();
  const organizations = await prisma.organization.findMany({
    where: term ? {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { headName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { city: { contains: term, mode: 'insensitive' } },
        { country: { contains: term, mode: 'insensitive' } },
      ],
    } : undefined,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      headName: true,
      email: true,
      contactNumber: true,
      city: true,
      country: true,
      status: true,
      isPlatformOwner: true,
      createdAt: true,
      users: { select: { role: true } },
    },
  });
  return organizations.map(({ users, ...organization }) => ({
    ...organization,
    counts: {
      students: users.filter(({ role }) => role === Role.STUDENT).length,
      staff: users.filter(({ role }) => role === Role.STAFF).length,
      instructors: users.filter(({ role }) => role === Role.INSTRUCTOR).length,
    },
  }));
}

export async function getPublicBrand(orgCode?: string) {
  const organization = orgCode
    ? await prisma.organization.findUnique({
      where: { code: orgCode },
      select: { name: true, isPlatformOwner: true },
    })
    : null;
  const isPartner = organization !== null && !organization.isPlatformOwner;
  const variant = isPartner ? 'PARTNER' : 'OWNER';
  if (!env.SHOW_PARTNER_ORG_NAME) return { variant };
  return {
    variant,
    organizationName: isPartner ? organization.name : null,
  };
}

export async function setPlatformOwner(organizationId: string, actorId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, isPlatformOwner: true },
      });
      if (!organization) throw new HttpError(404, 'Organization not found');
      if (organization.isPlatformOwner) return organization;

      const previousOwner = await tx.organization.findFirst({
        where: { isPlatformOwner: true },
        select: { id: true, name: true },
      });
      if (previousOwner) {
        await tx.organization.update({
          where: { id: previousOwner.id },
          data: { isPlatformOwner: false },
        });
        await tx.auditLog.create({
          data: {
            organizationId: previousOwner.id,
            actorId,
            action: 'PLATFORM_OWNER_UNSET',
            targetType: 'Organization',
            targetId: previousOwner.id,
            metadata: { newOwnerId: organization.id },
          },
        });
      }

      const updated = await tx.organization.update({
        where: { id: organizationId },
        data: { isPlatformOwner: true },
        select: { id: true, name: true, isPlatformOwner: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId,
          action: 'PLATFORM_OWNER_SET',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { previousOwnerId: previousOwner?.id ?? null },
        },
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'P2002' || error.code === 'P2034')) {
      throw new HttpError(409, 'Another platform owner was set at the same time. Refresh and try again.');
    }
    throw error;
  }
}

export async function approve(organizationId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new HttpError(404, 'Organization registration not found');
    if (organization.status !== OrganizationStatus.PENDING) throw new HttpError(409, 'This organization is no longer pending');
    if (!organization.pendingAdminPasswordHash) throw new HttpError(409, 'Organization registration is missing its administrator credentials');

    const code = await uniqueCode(tx, organization.name);
    const admin = await tx.user.create({
      data: {
        organizationId: organization.id,
        email: organization.email,
        name: organization.headName,
        phone: organization.contactNumber,
        passwordHash: organization.pendingAdminPasswordHash,
        role: Role.ORG_ADMIN,
        status: AccountStatus.APPROVED,
        approvedById: actorId,
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    const updated = await tx.organization.updateMany({
      where: { id: organizationId, status: OrganizationStatus.PENDING },
      data: {
        code,
        status: OrganizationStatus.ACTIVE,
        pendingAdminPasswordHash: null,
        approvedById: actorId,
        approvedAt: new Date(),
        rejectionReason: null,
      },
    });
    if (updated.count !== 1) throw new HttpError(409, 'This organization is no longer pending');
    await tx.auditLog.createMany({
      data: [
        {
          organizationId,
          actorId,
          action: 'ORGANIZATION_APPROVED',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { code },
        },
        {
          organizationId,
          actorId,
          action: 'ORG_ADMIN_ACCOUNT_CREATED',
          targetType: 'User',
          targetId: admin.id,
          metadata: { role: Role.ORG_ADMIN },
        },
      ],
    });
    return {
      id: organization.id,
      name: organization.name,
      code,
      status: OrganizationStatus.ACTIVE,
      adminUserId: admin.id,
    };
  });
}

export async function reject(organizationId: string, actorId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, status: true },
    });
    if (!organization) throw new HttpError(404, 'Organization registration not found');
    if (organization.status !== OrganizationStatus.PENDING) throw new HttpError(409, 'This organization is no longer pending');
    const updated = await tx.organization.updateMany({
      where: { id: organizationId, status: OrganizationStatus.PENDING },
      data: {
        status: OrganizationStatus.REJECTED,
        rejectionReason: reason,
        pendingAdminPasswordHash: null,
      },
    });
    if (updated.count !== 1) throw new HttpError(409, 'This organization is no longer pending');
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'ORGANIZATION_REJECTED',
        targetType: 'Organization',
        targetId: organizationId,
        metadata: { reason },
      },
    });
    return { id: organizationId, status: OrganizationStatus.REJECTED, rejectionReason: reason };
  });
}

export async function suspend(organizationId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, status: true },
    });
    if (!organization) throw new HttpError(404, 'Organization not found');
    if (organization.status !== OrganizationStatus.ACTIVE && organization.status !== OrganizationStatus.APPROVED) {
      throw new HttpError(409, 'Only an active organization can be suspended');
    }
    await tx.organization.update({
      where: { id: organizationId },
      data: { status: OrganizationStatus.SUSPENDED },
    });
    await tx.session.updateMany({
      where: { organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'ORGANIZATION_SUSPENDED',
        targetType: 'Organization',
        targetId: organizationId,
        metadata: {},
      },
    });
    return { id: organizationId, status: OrganizationStatus.SUSPENDED };
  });
}

export async function reactivate(organizationId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, status: true },
    });
    if (!organization) throw new HttpError(404, 'Organization not found');
    if (organization.status !== OrganizationStatus.SUSPENDED) {
      throw new HttpError(409, 'Only a suspended organization can be reactivated');
    }
    await tx.organization.update({
      where: { id: organizationId },
      data: { status: OrganizationStatus.ACTIVE },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'ORGANIZATION_REACTIVATED',
        targetType: 'Organization',
        targetId: organizationId,
        metadata: {},
      },
    });
    return { id: organizationId, status: OrganizationStatus.ACTIVE };
  });
}
