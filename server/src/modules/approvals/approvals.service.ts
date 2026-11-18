import { AccountStatus, NotificationType, RegistrationPaymentStatus, Role, StudentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { maskIdentifier } from '../students/student-identifiers.crypto.js';
import { notifyAfterCommit, notifyUsers } from '../notifications/notifications.service.js';

type DecisionStatus = typeof AccountStatus.APPROVED | typeof AccountStatus.REJECTED;
export type RegistrationStatus = typeof AccountStatus.PENDING | typeof AccountStatus.APPROVED | typeof AccountStatus.REJECTED;

function requireOrganizationId(organizationId: string | null): string {
  if (!organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

export async function listStudentRegistrations(organizationId: string | null, status: RegistrationStatus) {
  const tenantId = requireOrganizationId(organizationId);
  return prisma.studentProfile.findMany({
    where: {
      organizationId: tenantId,
      status: status as StudentStatus,
      user: { is: { organizationId: tenantId, role: Role.STUDENT, status } },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      studentId: true,
      status: true,
      interestedCourse: true,
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
  if (profile.userId === actorId) throw new HttpError(403, 'You cannot approve your own account');
  if (profile.status !== StudentStatus.PENDING) throw new HttpError(409, 'This registration is no longer pending');
  const registrationPayment = await prisma.registrationPayment.findFirst({
    where: { organizationId: tenantId, studentId: profile.userId },
    select: { status: true },
  });
  if (registrationPayment && registrationPayment.status !== RegistrationPaymentStatus.PAID) {
    throw new HttpError(409, 'Confirm the registration payment before reviewing this student');
  }

  const profileStatus = status === AccountStatus.APPROVED ? StudentStatus.APPROVED : StudentStatus.REJECTED;
  const now = new Date();
  const rejectionReason = reason?.trim() || null;
  await prisma.$transaction(async (tx) => {
    const userUpdate = await tx.user.updateMany({
      where: { id: profile.userId, organizationId: tenantId, role: Role.STUDENT, status: AccountStatus.PENDING },
      data: { status, rejectionReason: status === AccountStatus.REJECTED ? rejectionReason : null, approvedById: actorId, approvedAt: now },
    });
    const profileUpdate = await tx.studentProfile.updateMany({
      where: { id: profile.id, organizationId: tenantId, status: StudentStatus.PENDING },
      data: {
        status: profileStatus,
        rejectionReason: status === AccountStatus.REJECTED ? rejectionReason : null,
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
        metadata: { studentId, status },
      },
    });
  });
  if (status === AccountStatus.APPROVED) {
    await notifyAfterCommit(() => notifyUsers(tenantId, [profile.userId], {
      type: NotificationType.ACCOUNT_STATUS,
      title: 'Your registration was approved',
      body: 'You can now sign in to your learning portal.',
      link: '/student/login',
      dedupeKey: `student:${profile.userId}:approved`,
    }), 'student approval');
  }
  return { studentId, status: profileStatus, rejectionReason: status === AccountStatus.REJECTED ? rejectionReason : null };
}

export function approveStudent(organizationId: string | null, studentId: string, actorId: string) {
  return decideStudent(organizationId, studentId, actorId, AccountStatus.APPROVED);
}

export function rejectStudent(organizationId: string | null, studentId: string, actorId: string, reason?: string) {
  return decideStudent(organizationId, studentId, actorId, AccountStatus.REJECTED, reason);
}

export async function listTutorRegistrations(organizationId: string | null, status: RegistrationStatus) {
  const tenantId = requireOrganizationId(organizationId);
  const pending = await prisma.tutorProfile.findMany({
    where: {
      organizationId: tenantId,
      user: { is: { organizationId: tenantId, role: Role.TUTOR, status, accountRegistration: { isNot: null } } },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      tutorId: true,
      joiningDate: true,
      fatherName: true,
      motherName: true,
      interestedCourse: true,
      aadhaarLast4: true,
      apaarIdLast4: true,
      user: { select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true } },
    },
  });
  return pending.map(({ tutorId, aadhaarLast4, apaarIdLast4, ...profile }) => ({
    ...profile,
    tutorId,
    status: profile.user.status,
    aadhaarNumber: maskIdentifier(aadhaarLast4),
    apaarId: maskIdentifier(apaarIdLast4),
  }));
}

async function decideAccount(
  organizationId: string | null,
  userId: string,
  actorId: string,
  status: DecisionStatus,
  reason?: string,
) {
  const tenantId = requireOrganizationId(organizationId);
  if (actorId === userId) throw new HttpError(403, 'You cannot approve your own registration');
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: tenantId, role: Role.TUTOR, status: AccountStatus.PENDING },
    select: { id: true, email: true, accountRegistration: { select: { id: true } } },
  });
  if (!user) throw new HttpError(404, 'Tutor registration not found or no longer pending');

  const legacyStatus = status === AccountStatus.APPROVED ? StudentStatus.APPROVED : StudentStatus.REJECTED;
  const now = new Date();
  const rejectionReason = reason?.trim() || null;
  await prisma.$transaction(async (tx) => {
    const update = await tx.user.updateMany({
      where: { id: user.id, organizationId: tenantId, status: AccountStatus.PENDING },
      data: { status, rejectionReason: status === AccountStatus.REJECTED ? rejectionReason : null, approvedById: actorId, approvedAt: now },
    });
    if (update.count !== 1) throw new HttpError(409, 'This registration is no longer pending');
    if (user.accountRegistration) {
      await tx.accountApproval.updateMany({
        where: { id: user.accountRegistration.id, organizationId: tenantId, status: StudentStatus.PENDING },
        data: {
          status: legacyStatus,
          rejectionReason: status === AccountStatus.REJECTED ? rejectionReason : null,
          approvedById: actorId,
          approvedAt: now,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId,
        action: `TUTOR_${status}`,
        targetType: 'User',
        targetId: user.id,
        metadata: { status },
      },
    });
  });
  if (status === AccountStatus.APPROVED) {
    await notifyAfterCommit(() => notifyUsers(tenantId, [user.id], {
      type: NotificationType.ACCOUNT_STATUS,
      title: 'Your Tutor registration was approved',
      body: 'You can now sign in to the Tutor Portal.',
      link: '/tutor/login',
      dedupeKey: `account:${user.id}:approved`,
    }), 'Tutor approval');
  }
  return { userId: user.id, role: Role.TUTOR, status, rejectionReason: status === AccountStatus.REJECTED ? rejectionReason : null };
}

export function approveTutor(organizationId: string | null, userId: string, actorId: string) {
  return decideAccount(organizationId, userId, actorId, AccountStatus.APPROVED);
}

export function rejectTutor(organizationId: string | null, userId: string, actorId: string, reason?: string) {
  return decideAccount(organizationId, userId, actorId, AccountStatus.REJECTED, reason);
}
