import { StudentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';

export async function listPending(instructorId: string) {
  return prisma.studentProfile.findMany({
    where: {
      status: StudentStatus.PENDING,
      user: {
        OR: [
          { studentBatches: { none: {} } },
          { studentBatches: { some: { batch: { instructors: { some: { instructorId } } } } } },
        ],
      },
    },
    orderBy: { createdAt: 'asc' },
    select: { studentId: true, status: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
  });
}

async function assertInstructorOwnsOrUnassigned(studentId: string, instructorId: string) {
  const profile = await prisma.studentProfile.findUnique({
    where: { studentId },
    include: { user: { include: { studentBatches: { include: { batch: { include: { instructors: true } } } } } } },
  });
  if (!profile) throw new HttpError(404, 'Student registration not found');
  const memberships = profile.user.studentBatches;
  const hasAccess = memberships.length === 0 || memberships.some((membership) =>
    membership.batch.instructors.some((assignment) => assignment.instructorId === instructorId),
  );
  if (!hasAccess) throw new HttpError(403, 'This student belongs to another instructor’s batch');
  if (profile.status !== StudentStatus.PENDING) throw new HttpError(409, 'This registration is no longer pending');
  return profile;
}

async function decide(studentId: string, instructorId: string, status: typeof StudentStatus.APPROVED | typeof StudentStatus.REJECTED, reason?: string) {
  const profile = await assertInstructorOwnsOrUnassigned(studentId, instructorId);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const update = await tx.studentProfile.updateMany({
      where: { id: profile.id, status: StudentStatus.PENDING },
      data: {
        status,
        rejectionReason: status === StudentStatus.REJECTED ? reason ?? null : null,
        approvedById: instructorId,
        approvedAt: now,
      },
    });
    if (update.count !== 1) throw new HttpError(409, 'This registration is no longer pending');
    await tx.auditLog.create({
      data: {
        actorId: instructorId,
        action: status === StudentStatus.APPROVED ? 'STUDENT_APPROVED' : 'STUDENT_REJECTED',
        targetType: 'StudentProfile',
        targetId: profile.id,
        metadata: { studentId, reason: reason ?? null },
      },
    });
  });
  return { studentId, status, rejectionReason: status === StudentStatus.REJECTED ? reason ?? null : null };
}

export function approve(studentId: string, instructorId: string) {
  return decide(studentId, instructorId, StudentStatus.APPROVED);
}

export function reject(studentId: string, instructorId: string, reason?: string) {
  return decide(studentId, instructorId, StudentStatus.REJECTED, reason);
}

