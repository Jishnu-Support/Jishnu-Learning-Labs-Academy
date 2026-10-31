import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export async function listStudents(viewerId: string, role: Role) {
  const where = role === Role.INSTRUCTOR
    ? { user: { studentBatches: { some: { batch: { instructors: { some: { instructorId: viewerId } } } } } } }
    : role === Role.STUDENT ? { userId: viewerId } : {};
  const profiles = await prisma.studentProfile.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      studentId: true,
      status: true,
      user: {
        select: {
          id: true,
          name: true,
          ...(role === Role.SUPER_ADMIN ? { email: true } : {}),
          studentBatches: { select: { batch: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  return profiles.map(({ user, ...profile }) => ({
    ...profile,
    user: { ...user, batches: user.studentBatches.map(({ batch }) => batch), studentBatches: undefined },
  }));
}
