import { EnrollmentStatus, Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';

export async function canAccessContent(input: {
  organizationId: string;
  userId: string;
  role: Role;
  courseId: string | null;
  published: boolean;
  freePreview?: boolean;
}): Promise<boolean> {
  if (input.role !== Role.STUDENT) return true;
  if (!input.published) return false;
  if (!input.courseId) return true;
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      organizationId: input.organizationId,
      studentId: input.userId,
      courseId: input.courseId,
      status: EnrollmentStatus.ACTIVE,
    },
    select: { id: true },
  });
  if (!enrollment) return false;
  const organization = await prisma.organization.findFirst({
    where: { id: input.organizationId },
    select: { paymentsEnabled: true },
  });
  if (!organization?.paymentsEnabled || input.freePreview) return true;
  return Boolean(await prisma.subscription.findFirst({
    where: {
      organizationId: input.organizationId,
      studentId: input.userId,
      courseId: input.courseId,
      status: 'ACTIVE',
      endsAt: { gt: new Date() },
    },
    select: { id: true },
  }));
}

export async function requireContentAccess(input: Parameters<typeof canAccessContent>[0]): Promise<void> {
  if (!await canAccessContent(input)) {
    throw new HttpError(402, 'A current course subscription is required. Open Pay My Fee to unlock access.');
  }
}
