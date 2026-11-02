import bcrypt from 'bcrypt';
import { AccountStatus, Prisma, Role, StudentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';

type StaffListInput = { search?: string; status?: AccountStatus; page: number; pageSize: number };
type NewStaff = { staffId: string; name: string; phone: string; email: string; joiningDate: string; temporaryPassword: string };
type StaffUpdate = Partial<Omit<NewStaff, 'temporaryPassword'>>;

function requireOrganizationId(organizationId: string | null): string {
  if (!organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

function staffWhere(organizationId: string, input: StaffListInput): Prisma.StaffProfileWhereInput {
  return {
    organizationId,
    user: {
      is: {
        organizationId,
        role: Role.STAFF,
        ...(input.status ? { status: input.status } : {}),
      },
    },
    ...(input.search ? {
      OR: [
        { staffId: { contains: input.search, mode: 'insensitive' } },
        { user: { is: { organizationId, role: Role.STAFF, name: { contains: input.search, mode: 'insensitive' } } } },
      ],
    } : {}),
  };
}

const staffSelection = {
  staffId: true,
  joiningDate: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true } },
} satisfies Prisma.StaffProfileSelect;

export async function listStaff(organizationId: string | null, input: StaffListInput) {
  const tenantId = requireOrganizationId(organizationId);
  const where = staffWhere(tenantId, input);
  const [total, staff] = await prisma.$transaction([
    prisma.staffProfile.count({ where }),
    prisma.staffProfile.findMany({
      where,
      orderBy: { joiningDate: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: staffSelection,
    }),
  ]);
  return {
    staff,
    pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
  };
}

export async function getStaff(organizationId: string | null, userId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const staff = await prisma.staffProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.STAFF } } },
    select: staffSelection,
  });
  if (!staff) throw new HttpError(404, 'Staff member not found');
  return staff;
}

export async function createStaff(organizationId: string | null, actorId: string, input: NewStaff) {
  const tenantId = requireOrganizationId(organizationId);
  const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);
  try {
    const staff = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: tenantId,
          email: input.email,
          passwordHash,
          name: input.name,
          phone: input.phone,
          role: Role.STAFF,
          status: AccountStatus.APPROVED,
          approvedById: actorId,
          approvedAt: new Date(),
          mustChangePassword: true,
          staffProfile: {
            create: {
              organizationId: tenantId,
              staffId: input.staffId,
              joiningDate: new Date(`${input.joiningDate}T00:00:00.000Z`),
            },
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId,
          action: 'STAFF_CREATED',
          targetType: 'User',
          targetId: user.id,
          metadata: { staffId: input.staffId, email: input.email },
        },
      });
      return tx.staffProfile.findFirstOrThrow({ where: { userId: user.id, organizationId: tenantId }, select: staffSelection });
    });
    return { staff, temporaryPassword: input.temporaryPassword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'Staff ID or email is already in use in this organization');
    }
    throw error;
  }
}

export async function updateStaff(organizationId: string | null, userId: string, actorId: string, input: StaffUpdate) {
  const tenantId = requireOrganizationId(organizationId);
  const current = await prisma.staffProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.STAFF } } },
    select: { id: true, userId: true },
  });
  if (!current) throw new HttpError(404, 'Staff member not found');
  try {
    await prisma.$transaction(async (tx) => {
      if (input.name !== undefined || input.email !== undefined || input.phone !== undefined) {
        await tx.user.update({
          where: { id: current.userId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
          },
        });
      }
      if (input.staffId !== undefined || input.joiningDate !== undefined) {
        await tx.staffProfile.update({
          where: { id: current.id },
          data: {
            ...(input.staffId !== undefined ? { staffId: input.staffId } : {}),
            ...(input.joiningDate !== undefined ? { joiningDate: new Date(`${input.joiningDate}T00:00:00.000Z`) } : {}),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId,
          action: 'STAFF_UPDATED',
          targetType: 'User',
          targetId: current.userId,
          metadata: { changedFields: Object.keys(input) },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'Staff ID or email is already in use in this organization');
    }
    throw error;
  }
  return getStaff(tenantId, userId);
}

async function setStaffStatus(
  organizationId: string | null,
  userId: string,
  actorId: string,
  status: typeof AccountStatus.APPROVED | typeof AccountStatus.SUSPENDED,
) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.staffProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.STAFF } } },
    select: { id: true, user: { select: { status: true, accountRegistration: { select: { id: true } } } } },
  });
  if (!profile) throw new HttpError(404, 'Staff member not found');
  if (status === AccountStatus.SUSPENDED && profile.user.status !== AccountStatus.APPROVED) {
    throw new HttpError(409, 'Only approved staff can be suspended');
  }
  if (status === AccountStatus.APPROVED && profile.user.status !== AccountStatus.SUSPENDED) {
    throw new HttpError(409, 'Only suspended staff can be reactivated');
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId, organizationId: tenantId, role: Role.STAFF, status: profile.user.status },
      data: { status, rejectionReason: null },
    });
    if (updated.count !== 1) throw new HttpError(409, 'Staff status changed; refresh and try again');
    if (profile.user.accountRegistration) {
      await tx.accountApproval.updateMany({
        where: { id: profile.user.accountRegistration.id, organizationId: tenantId },
        data: { status: status === AccountStatus.APPROVED ? StudentStatus.APPROVED : StudentStatus.SUSPENDED },
      });
    }
    if (status === AccountStatus.SUSPENDED) {
      await tx.session.updateMany({
        where: { organizationId: tenantId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId,
        action: status === AccountStatus.SUSPENDED ? 'STAFF_SUSPENDED' : 'STAFF_REACTIVATED',
        targetType: 'User',
        targetId: userId,
        metadata: {},
      },
    });
  });
  return getStaff(tenantId, userId);
}

export function suspendStaff(organizationId: string | null, userId: string, actorId: string) {
  return setStaffStatus(organizationId, userId, actorId, AccountStatus.SUSPENDED);
}

export function reactivateStaff(organizationId: string | null, userId: string, actorId: string) {
  return setStaffStatus(organizationId, userId, actorId, AccountStatus.APPROVED);
}
