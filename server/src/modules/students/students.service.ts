import { AccountStatus, Prisma, Role, StudentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';

type StudentListInput = { search?: string; status?: AccountStatus; page: number; pageSize: number };

function requireOrganizationId(organizationId: string | null): string {
  if (!organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

function studentWhere(organizationId: string, input: StudentListInput): Prisma.StudentProfileWhereInput {
  return {
    organizationId,
    user: {
      is: {
        organizationId,
        role: Role.STUDENT,
        ...(input.status ? { status: input.status } : {}),
      },
    },
    ...(input.search ? {
      OR: [
        { studentId: { contains: input.search, mode: 'insensitive' } },
        { user: { is: { organizationId, role: Role.STUDENT, name: { contains: input.search, mode: 'insensitive' } } } },
      ],
    } : {}),
  };
}

export async function listStudents(organizationId: string | null, input: StudentListInput) {
  const tenantId = requireOrganizationId(organizationId);
  const where = studentWhere(tenantId, input);
  const [total, profiles] = await prisma.$transaction([
    prisma.studentProfile.count({ where }),
    prisma.studentProfile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        studentId: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            createdAt: true,
            studentBatches: {
              where: { organizationId: tenantId },
              select: { batch: { select: { id: true, name: true } } },
            },
          },
        },
      },
    }),
  ]);
  return {
    students: profiles.map(({ user, ...profile }) => ({
      ...profile,
      status: user.status,
      user: { ...user, batches: user.studentBatches.map(({ batch }) => batch), studentBatches: undefined },
    })),
    pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
  };
}

export async function getStudent(organizationId: string | null, studentId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.studentProfile.findFirst({
    where: { organizationId: tenantId, studentId, user: { is: { organizationId: tenantId, role: Role.STUDENT } } },
    select: {
      studentId: true,
      status: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
          studentBatches: {
            where: { organizationId: tenantId },
            select: { batch: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!profile) throw new HttpError(404, 'Student not found');
  const recentLogins = await prisma.loginLog.findMany({
    where: { organizationId: tenantId, userId: profile.user.id, success: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { createdAt: true },
  });
  return {
    ...profile,
    status: profile.user.status,
    user: { ...profile.user, batches: profile.user.studentBatches.map(({ batch }) => batch), studentBatches: undefined },
    loginHistory: { lastLoginAt: recentLogins[0]?.createdAt ?? null, recentLogins },
  };
}

async function setStudentStatus(
  organizationId: string | null,
  studentId: string,
  actorId: string,
  status: typeof AccountStatus.APPROVED | typeof AccountStatus.SUSPENDED,
) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.studentProfile.findFirst({
    where: { organizationId: tenantId, studentId, user: { is: { organizationId: tenantId, role: Role.STUDENT } } },
    select: { id: true, userId: true, status: true, user: { select: { status: true } } },
  });
  if (!profile) throw new HttpError(404, 'Student not found');
  if (status === AccountStatus.SUSPENDED && profile.user.status !== AccountStatus.APPROVED) {
    throw new HttpError(409, 'Only an approved student can be suspended');
  }
  if (status === AccountStatus.APPROVED && profile.user.status !== AccountStatus.SUSPENDED) {
    throw new HttpError(409, 'Only a suspended student can be reactivated');
  }
  const profileStatus = status === AccountStatus.SUSPENDED ? StudentStatus.SUSPENDED : StudentStatus.APPROVED;
  await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.updateMany({
      where: { id: profile.userId, organizationId: tenantId, role: Role.STUDENT, status: profile.user.status },
      data: { status, rejectionReason: null },
    });
    const updatedProfile = await tx.studentProfile.updateMany({
      where: { id: profile.id, organizationId: tenantId, status: profile.status },
      data: { status: profileStatus, rejectionReason: null },
    });
    if (updatedUser.count !== 1 || updatedProfile.count !== 1) throw new HttpError(409, 'Student status changed; refresh and try again');
    if (status === AccountStatus.SUSPENDED) {
      await tx.session.updateMany({
        where: { organizationId: tenantId, userId: profile.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: tenantId,
        actorId,
        action: status === AccountStatus.SUSPENDED ? 'STUDENT_SUSPENDED' : 'STUDENT_REACTIVATED',
        targetType: 'StudentProfile',
        targetId: profile.id,
        metadata: { studentId },
      },
    });
  });
  return { studentId, status };
}

export function suspendStudent(organizationId: string | null, studentId: string, actorId: string) {
  return setStudentStatus(organizationId, studentId, actorId, AccountStatus.SUSPENDED);
}

export function reactivateStudent(organizationId: string | null, studentId: string, actorId: string) {
  return setStudentStatus(organizationId, studentId, actorId, AccountStatus.APPROVED);
}
