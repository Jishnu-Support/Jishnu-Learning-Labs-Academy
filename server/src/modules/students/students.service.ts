import bcrypt from 'bcrypt';
import { AccountStatus, EnrollmentStatus, Prisma, Role, StudentStatus } from '@prisma/client';
import { fileTypeFromBuffer } from 'file-type';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';
import { decryptStudentIdentifier, encryptStudentIdentifier, maskStudentIdentifier } from './student-identifiers.crypto.js';
import { studentPhotoStorage } from './student-photo.storage.js';

type StudentListInput = { search?: string; status?: AccountStatus; page: number; pageSize: number };

function requireOrganizationId(organizationId: string | null): string {
  if (!organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

function studentWhere(organizationId: string, input: StudentListInput, actorRole: Role, actorId: string): Prisma.StudentProfileWhereInput {
  return {
    organizationId,
    user: {
      is: {
        organizationId,
        role: Role.STUDENT,
        ...(input.status ? { status: input.status } : {}),
        ...(actorRole === Role.TUTOR ? {
          enrollments: {
            some: {
              organizationId,
              status: EnrollmentStatus.ACTIVE,
              selectedTutorId: actorId,
              course: { instructors: { some: { organizationId, instructorId: actorId } } },
            },
          },
        } : {}),
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

export async function listStudents(organizationId: string | null, input: StudentListInput, actorRole: Role, actorId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const where = studentWhere(tenantId, input, actorRole, actorId);
  if (actorRole === Role.TUTOR) {
    const [total, profiles] = await prisma.$transaction([
      prisma.studentProfile.count({ where }),
      prisma.studentProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          studentId: true,
          educationLevel: true,
          user: {
            select: {
              id: true,
              name: true,
              enrollments: {
                where: {
                  organizationId: tenantId,
                  status: EnrollmentStatus.ACTIVE,
                  selectedTutorId: actorId,
                  course: { instructors: { some: { organizationId: tenantId, instructorId: actorId } } },
                },
                select: {
                  course: {
                    select: {
                      id: true,
                      title: true,
                      topics: { where: { organizationId: tenantId }, select: { covered: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);
    return {
      students: profiles.map(({ user, ...profile }) => ({
        ...profile,
        user: { id: user.id, name: user.name },
        courseProgress: user.enrollments.map(({ course }) => ({
          courseId: course.id,
          courseTitle: course.title,
          percent: course.topics.length
            ? Math.round((course.topics.filter(({ covered }) => covered).length / course.topics.length) * 100)
            : 0,
        })),
      })),
      pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
    };
  }
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

export async function getStudent(organizationId: string | null, studentId: string, actorRole: Role, actorId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.studentProfile.findFirst({
    where: {
      organizationId: tenantId,
      studentId,
      user: {
        is: {
          organizationId: tenantId,
          role: Role.STUDENT,
          ...(actorRole === Role.TUTOR ? {
            enrollments: {
              some: {
                organizationId: tenantId,
                status: EnrollmentStatus.ACTIVE,
                selectedTutorId: actorId,
                course: { instructors: { some: { organizationId: tenantId, instructorId: actorId } } },
              },
            },
          } : {}),
        },
      },
    },
    select: {
      studentId: true,
      status: true,
      ...(actorRole === Role.ORG_ADMIN ? { fatherName: true, motherName: true } : {}),
      educationLevel: true,
      currentEducation: true,
      ...(actorRole === Role.ORG_ADMIN ? { currentCourse: true, institutionName: true } : {}),
      ...(actorRole === Role.ORG_ADMIN ? { aadhaarLast4: true, apaarIdLast4: true, isDemoIdentityData: true } : {}),
      ...(actorRole === Role.ORG_ADMIN ? { profilePhotoStorageKey: true } : {}),
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          ...(actorRole === Role.ORG_ADMIN ? { email: true, phone: true } : {}),
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
  if (actorRole === Role.TUTOR) {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        organizationId: tenantId,
        studentId: profile.user.id,
        status: EnrollmentStatus.ACTIVE,
        selectedTutorId: actorId,
        course: { instructors: { some: { organizationId: tenantId, instructorId: actorId } } },
      },
      select: {
        course: {
          select: {
            id: true,
            title: true,
            topics: { where: { organizationId: tenantId }, select: { covered: true } },
          },
        },
      },
    });
    return {
      studentId: profile.studentId,
      educationLevel: profile.educationLevel,
      user: { id: profile.user.id, name: profile.user.name },
      courseProgress: enrollments.map(({ course }) => ({
        courseId: course.id,
        courseTitle: course.title,
        percent: course.topics.length
          ? Math.round((course.topics.filter(({ covered }) => covered).length / course.topics.length) * 100)
          : 0,
      })),
    };
  }
  const recentLogins = await prisma.loginLog.findMany({
    where: { organizationId: tenantId, userId: profile.user.id, success: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { createdAt: true },
  });
  const { profilePhotoStorageKey, ...safeProfile } = profile;
  return {
    ...safeProfile,
    ...(actorRole === Role.ORG_ADMIN ? { hasPhoto: Boolean(profilePhotoStorageKey) } : {}),
    aadhaarNumber: maskStudentIdentifier(profile.aadhaarLast4),
    apaarId: maskStudentIdentifier(profile.apaarIdLast4),
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

const selfProfileSelection = {
  id: true,
  studentId: true,
  fatherName: true,
  motherName: true,
  currentEducation: true,
  currentCourse: true,
  institutionName: true,
  educationLevel: true,
  educationYear: true,
  profilePhotoStorageKey: true,
  aadhaarLast4: true,
  apaarIdLast4: true,
  piiConsentAt: true,
  isDemoIdentityData: true,
  organization: { select: { name: true, code: true } },
  selectedTutor: {
    select: {
      id: true,
      name: true,
      tutorProfile: { select: { bio: true, expertise: true, joiningDate: true, photoStorageKey: true } },
    },
  },
  user: { select: { id: true, name: true, email: true, phone: true } },
} satisfies Prisma.StudentProfileSelect;

function serializeSelfProfile(profile: Prisma.StudentProfileGetPayload<{ select: typeof selfProfileSelection }>) {
  const { profilePhotoStorageKey, aadhaarLast4, apaarIdLast4, selectedTutor, ...rest } = profile;
  return {
    ...rest,
    aadhaarFieldEnabled: env.ENABLE_AADHAAR_FIELD,
    hasPhoto: Boolean(profilePhotoStorageKey),
    aadhaarNumber: maskStudentIdentifier(aadhaarLast4),
    apaarId: maskStudentIdentifier(apaarIdLast4),
    selectedTutor: selectedTutor ? {
      id: selectedTutor.id,
      name: selectedTutor.name,
      bio: selectedTutor.tutorProfile?.bio ?? null,
      expertise: selectedTutor.tutorProfile?.expertise ?? [],
      joiningDate: selectedTutor.tutorProfile?.joiningDate ?? null,
      hasPhoto: Boolean(selectedTutor.tutorProfile?.photoStorageKey),
    } : null,
  };
}

export async function getMyStudentProfile(organizationId: string | null, userId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.studentProfile.findFirst({
    where: { organizationId: tenantId, userId, user: { is: { organizationId: tenantId, role: Role.STUDENT } } },
    select: selfProfileSelection,
  });
  if (!profile) throw new HttpError(404, 'Student profile not found');
  return serializeSelfProfile(profile);
}

export async function updateMyStudentProfile(
  organizationId: string | null,
  userId: string,
  actorId: string,
  input: {
    name?: string; phone?: string | null; fatherName?: string | null; motherName?: string | null;
    currentEducation?: string | null; educationLevel?: string | null; educationYear?: string | null;
    currentCourse?: string | null; institutionName?: string | null; piiConsent?: boolean;
    aadhaarNumber?: string | null; apaarId?: string | null;
  },
) {
  const tenantId = requireOrganizationId(organizationId);
  const existing = await prisma.studentProfile.findFirst({
    where: { organizationId: tenantId, userId, user: { is: { organizationId: tenantId, role: Role.STUDENT } } },
    select: { id: true, piiConsentAt: true },
  });
  if (!existing) throw new HttpError(404, 'Student profile not found');

  const profileData: Prisma.StudentProfileUpdateInput = {
    ...(input.aadhaarNumber !== undefined || input.piiConsent === false ? {
      aadhaarEncrypted: input.piiConsent === false ? null : input.aadhaarNumber ? encryptStudentIdentifier(input.aadhaarNumber) : null,
      aadhaarLast4: input.piiConsent === false ? null : input.aadhaarNumber?.slice(-4) ?? null,
    } : {}),
    ...(input.apaarId !== undefined || input.piiConsent === false ? {
      apaarIdEncrypted: input.piiConsent === false ? null : input.apaarId ? encryptStudentIdentifier(input.apaarId) : null,
      apaarIdLast4: input.piiConsent === false ? null : input.apaarId?.slice(-4) ?? null,
    } : {}),
    ...(input.piiConsent === false
      ? { piiConsentAt: null }
      : input.piiConsent === true && !existing.piiConsentAt
        ? { piiConsentAt: new Date() }
        : {}),
    ...(input.aadhaarNumber || input.apaarId || input.piiConsent === false ? { isDemoIdentityData: false } : {}),
    ...(input.fatherName !== undefined ? { fatherName: input.fatherName?.trim() || null } : {}),
    ...(input.motherName !== undefined ? { motherName: input.motherName?.trim() || null } : {}),
    ...(input.currentEducation !== undefined ? { currentEducation: input.currentEducation?.trim() || null } : {}),
    ...(input.educationLevel !== undefined ? { educationLevel: input.educationLevel || null } : {}),
    ...(input.educationYear !== undefined ? { educationYear: input.educationYear?.trim() || null } : {}),
    ...(input.currentCourse !== undefined ? { currentCourse: input.currentCourse?.trim() || null } : {}),
    ...(input.institutionName !== undefined ? { institutionName: input.institutionName?.trim() || null } : {}),
  };

  try {
    await prisma.$transaction(async (tx) => {
      if (input.name !== undefined || input.phone !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
          },
        });
      }
      if (Object.keys(profileData).length) {
        await tx.studentProfile.update({ where: { id: existing.id }, data: profileData });
      }
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId,
          action: 'STUDENT_PROFILE_UPDATED',
          targetType: 'StudentProfile',
          targetId: existing.id,
          metadata: { changedFields: Object.keys(input) },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'That email address is already in use in your organization');
    }
    throw error;
  }
  return getMyStudentProfile(tenantId, userId);
}

export async function uploadMyStudentPhoto(organizationId: string | null, userId: string, buffer: Buffer) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.studentProfile.findFirst({
    where: { organizationId: tenantId, userId, user: { is: { organizationId: tenantId, role: Role.STUDENT } } },
    select: { id: true, profilePhotoStorageKey: true },
  });
  if (!profile) throw new HttpError(404, 'Student profile not found');
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !['png', 'jpg', 'webp'].includes(detected.ext)) {
    throw new HttpError(400, 'Profile photos must be PNG, JPG, or WEBP images');
  }
  const storageKey = await studentPhotoStorage.save(buffer, `.${detected.ext}`);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.studentProfile.update({ where: { id: profile.id }, data: { profilePhotoStorageKey: storageKey } });
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId: userId,
          action: 'STUDENT_PROFILE_PHOTO_UPDATED',
          targetType: 'StudentProfile',
          targetId: profile.id,
          metadata: {},
        },
      });
    });
  } catch (error) {
    await studentPhotoStorage.remove(storageKey);
    throw error;
  }
  if (profile.profilePhotoStorageKey) {
    try {
      await studentPhotoStorage.remove(profile.profilePhotoStorageKey);
    } catch (error) {
      logger.error({ err: error, userId, organizationId: tenantId }, 'Unable to remove the replaced student profile photo');
    }
  }
  return { photoUrl: '/students/me/photo' };
}

export async function getMyStudentPhoto(organizationId: string | null, userId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.studentProfile.findFirst({
    where: { organizationId: tenantId, userId, user: { is: { organizationId: tenantId, role: Role.STUDENT } } },
    select: { profilePhotoStorageKey: true },
  });
  if (!profile?.profilePhotoStorageKey) throw new HttpError(404, 'Student profile photo not found');
  const file = await studentPhotoStorage.open(profile.profilePhotoStorageKey);
  const extension = profile.profilePhotoStorageKey.split('.').pop();
  const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  return { ...file, mimeType };
}

export async function getStudentPhoto(organizationId: string | null, studentId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.studentProfile.findFirst({
    where: { organizationId: tenantId, studentId, user: { is: { organizationId: tenantId, role: Role.STUDENT } } },
    select: { profilePhotoStorageKey: true },
  });
  if (!profile?.profilePhotoStorageKey) throw new HttpError(404, 'Student profile photo not found');
  const file = await studentPhotoStorage.open(profile.profilePhotoStorageKey);
  const extension = profile.profilePhotoStorageKey.split('.').pop();
  const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  return { ...file, mimeType };
}

export async function revealStudentIdentifier(
  organizationId: string | null,
  studentId: string,
  actorId: string,
  actorRole: Role,
  input: { field: 'aadhaar' | 'apaar'; password: string; reason?: string },
) {
  const tenantId = requireOrganizationId(organizationId);
  if (actorRole !== Role.ORG_ADMIN && (actorRole !== Role.STUDENT || actorId !== studentId)) {
    throw new HttpError(403, 'You are not allowed to reveal this identifier');
  }
  const profile = await prisma.studentProfile.findFirst({
    where: {
      organizationId: tenantId,
      ...(actorRole === Role.STUDENT ? { userId: actorId } : { studentId }),
      user: { is: { organizationId: tenantId, role: Role.STUDENT } },
    },
    select: {
      id: true,
      studentId: true,
      aadhaarEncrypted: true,
      apaarIdEncrypted: true,
      user: { select: { id: true, passwordHash: true } },
    },
  });
  if (!profile) throw new HttpError(404, 'Student not found');
  const actor = actorRole === Role.STUDENT
    ? profile.user
    : await prisma.user.findFirst({
      where: { id: actorId, organizationId: tenantId, role: Role.ORG_ADMIN, isActive: true, status: AccountStatus.APPROVED },
      select: { id: true, passwordHash: true },
    });
  if (!actor || !(await bcrypt.compare(input.password, actor.passwordHash))) {
    throw new HttpError(401, 'Password verification failed');
  }
  const encrypted = input.field === 'aadhaar' ? profile.aadhaarEncrypted : profile.apaarIdEncrypted;
  const identifier = encrypted ? decryptStudentIdentifier(encrypted) : null;
  const safeReason = input.reason?.replace(/(?:\d[\s-]*){12,}/g, '[redacted identifier]');
  await prisma.auditLog.create({
    data: {
      organizationId: tenantId,
      actorId,
      action: 'STUDENT_IDENTIFIER_REVEALED',
      targetType: 'StudentProfile',
      targetId: profile.id,
      metadata: {
        field: input.field,
        studentId: profile.studentId,
        ...(safeReason ? { reason: safeReason } : {}),
      },
    },
  });
  return { field: input.field, value: identifier };
}
