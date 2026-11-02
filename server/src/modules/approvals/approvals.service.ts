import { AccountStatus, Role, StudentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';

type DecisionStatus = typeof AccountStatus.APPROVED | typeof AccountStatus.REJECTED;

function requireOrganizationId(organizationId: string | null): string {
  if (!organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

export async function listPendingStudents(organizationId: string | null) {
  const tenantId = requireOrganizationId(organizationId);
  return prisma.studentProfile.findMany({
    where: {
      organizationId: tenantId,
      status: StudentStatus.PENDING,
      user: { is: { organizationId: tenantId, role: Role.STUDENT, status: AccountStatus.PENDING } },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      studentId: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, phone: true, createdAt: true } },
    },
  });
}

async function decideStudent(
  organizationId: string | null,
  studentId: string,
  actorId: string,
  status: DecisionStatus,
  reason?: string,
) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.studentProfile.findUnique({
    where: { organizationId_studentId: { organizationId: tenantId, studentId } },
    select: { id: true, userId: true, status: true },
  });
  if (!profile) throw new HttpError(404, 'Student registration not found');
  if (profile.status !== StudentStatus.PENDING) throw new HttpError(409, 'This registration is no longer pending');

  const profileStatus = status === AccountStatus.APPROVED ? StudentStatus.APPROVED : StudentStatus.REJECTED;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const userUpdate = await tx.user.updateMany({
      where: { id: profile.userId, organizationId: tenantId, role: Role.STUDENT, status: AccountStatus.PENDING },
      data: { status, rejectionReason: status === AccountStatus.REJECTED ? reason ?? null : null, approvedById: actorId, approvedAt: now },
    });
    const profileUpdate = await tx.studentProfile.updateMany({
      where: { id: profile.id, organizationId: tenantId, status: StudentStatus.PENDING },
      data: {
        status: profileStatus,
        rejectionReason: status === AccountStatus.REJECTED ? reason ?? null : null,
        approvedById: actorId,
        approvedAt: now,
      },
    });
    if (userUpdate.count !== 1 || profileUpdate.count !== 1) throw new HttpError(409, 'This registration is no longer pending');
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId,
        action: status === AccountStatus.APPROVED ? 'STUDENT_APPROVED' : 'STUDENT_REJECTED',
        targetType: 'StudentProfile',
        targetId: profile.id,
        metadata: { studentId, reason: reason ?? null },
      },
    });
  });
  return { studentId, status: profileStatus, rejectionReason: status === AccountStatus.REJECTED ? reason ?? null : null };
}

export function approveStudent(organizationId: string | null, studentId: string, actorId: string) {
  return decideStudent(organizationId, studentId, actorId, AccountStatus.APPROVED);
}

export function rejectStudent(organizationId: string | null, studentId: string, actorId: string, reason: string) {
  return decideStudent(organizationId, studentId, actorId, AccountStatus.REJECTED, reason);
}

export async function listPendingStaff(organizationId: string | null) {
  const tenantId = requireOrganizationId(organizationId);
  return prisma.staffProfile.findMany({
    where: {
      organizationId: tenantId,
      user: { is: { organizationId: tenantId, role: Role.STAFF, status: AccountStatus.PENDING } },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      staffId: true,
      joiningDate: true,
      user: { select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true } },
    },
  });
}

export async function listPendingInstructors(organizationId: string | null) {
  const tenantId = requireOrganizationId(organizationId);
  return prisma.user.findMany({
    where: { organizationId: tenantId, role: Role.INSTRUCTOR, status: AccountStatus.PENDING },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true },
  });
}

async function decideAccount(
  organizationId: string | null,
  userId: string,
  actorId: string,
  role: typeof Role.INSTRUCTOR | typeof Role.STAFF,
  status: DecisionStatus,
  reason?: string,
) {
  const tenantId = requireOrganizationId(organizationId);
  if (actorId === userId) throw new HttpError(403, 'You cannot approve your own registration');
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: tenantId, role, status: AccountStatus.PENDING },
    select: { id: true, email: true, accountRegistration: { select: { id: true } } },
  });
  if (!user) throw new HttpError(404, `${role.toLowerCase()} registration not found or no longer pending`);

  const legacyStatus = status === AccountStatus.APPROVED ? StudentStatus.APPROVED : StudentStatus.REJECTED;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const update = await tx.user.updateMany({
      where: { id: user.id, organizationId: tenantId, status: AccountStatus.PENDING },
      data: { status, rejectionReason: status === AccountStatus.REJECTED ? reason ?? null : null, approvedById: actorId, approvedAt: now },
    });
    if (update.count !== 1) throw new HttpError(409, 'This registration is no longer pending');
    if (user.accountRegistration) {
      await tx.accountApproval.updateMany({
        where: { id: user.accountRegistration.id, organizationId: tenantId, status: StudentStatus.PENDING },
        data: {
          status: legacyStatus,
          rejectionReason: status === AccountStatus.REJECTED ? reason ?? null : null,
          approvedById: actorId,
          approvedAt: now,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId,
        action: `${role}_${status}`,
        targetType: 'User',
        targetId: user.id,
        metadata: { email: user.email, reason: reason ?? null },
      },
    });
  });
  return { userId: user.id, role, status, rejectionReason: status === AccountStatus.REJECTED ? reason ?? null : null };
}

export function approveInstructor(organizationId: string | null, userId: string, actorId: string) {
  return decideAccount(organizationId, userId, actorId, Role.INSTRUCTOR, AccountStatus.APPROVED);
}

export function rejectInstructor(organizationId: string | null, userId: string, actorId: string, reason: string) {
  return decideAccount(organizationId, userId, actorId, Role.INSTRUCTOR, AccountStatus.REJECTED, reason);
}

export function approveStaff(organizationId: string | null, userId: string, actorId: string) {
  return decideAccount(organizationId, userId, actorId, Role.STAFF, AccountStatus.APPROVED);
}

export function rejectStaff(organizationId: string | null, userId: string, actorId: string, reason: string) {
  return decideAccount(organizationId, userId, actorId, Role.STAFF, AccountStatus.REJECTED, reason);
}
