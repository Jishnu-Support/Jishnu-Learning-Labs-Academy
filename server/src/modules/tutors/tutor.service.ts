import bcrypt from 'bcrypt';
import { AccountStatus, Prisma, Role, StudentStatus } from '@prisma/client';
import { fileTypeFromBuffer } from 'file-type';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { tutorPhotoStorage } from './tutor-photo.storage.js';

type TutorListInput = { search?: string; status?: AccountStatus; page: number; pageSize: number };
type NewTutor = { tutorId: string; name: string; phone: string; email: string; joiningDate: string; temporaryPassword: string; bio?: string; expertise: string[] };
type TutorUpdate = Partial<Omit<NewTutor, 'temporaryPassword'>>;

function requireOrganizationId(organizationId: string | null): string {
  if (!organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

function tutorWhere(organizationId: string, input: TutorListInput): Prisma.TutorProfileWhereInput {
  return {
    organizationId,
    user: {
      is: {
        organizationId,
        role: Role.TUTOR,
        ...(input.status ? { status: input.status } : {}),
      },
    },
    ...(input.search ? {
      OR: [
        { tutorId: { contains: input.search, mode: 'insensitive' } },
        { user: { is: { organizationId, role: Role.TUTOR, name: { contains: input.search, mode: 'insensitive' } } } },
      ],
    } : {}),
  };
}

const tutorSelection = {
  tutorId: true,
  joiningDate: true,
  bio: true,
  expertise: true,
  photoStorageKey: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true } },
} satisfies Prisma.TutorProfileSelect;

function serializeTutor<T extends { tutorId: string; photoStorageKey: string | null }>(profile: T) {
  const { tutorId, photoStorageKey, ...rest } = profile;
  return { ...rest, tutorId: tutorId, hasPhoto: Boolean(photoStorageKey) };
}

export async function listTutor(organizationId: string | null, input: TutorListInput) {
  const tenantId = requireOrganizationId(organizationId);
  const where = tutorWhere(tenantId, input);
  const [total, tutor] = await prisma.$transaction([
    prisma.tutorProfile.count({ where }),
    prisma.tutorProfile.findMany({
      where,
      orderBy: { joiningDate: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: tutorSelection,
    }),
  ]);
  return {
    tutors: tutor.map(serializeTutor),
    pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
  };
}

export async function getTutor(organizationId: string | null, userId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const tutor = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR } } },
    select: tutorSelection,
  });
  if (!tutor) throw new HttpError(404, 'Tutor not found');
  return serializeTutor(tutor);
}

export async function createTutor(organizationId: string | null, actorId: string, input: NewTutor) {
  const tenantId = requireOrganizationId(organizationId);
  const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);
  try {
    const tutor = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: tenantId,
          email: input.email,
          passwordHash,
          name: input.name,
          phone: input.phone,
          role: Role.TUTOR,
          status: AccountStatus.APPROVED,
          approvedById: actorId,
          approvedAt: new Date(),
          mustChangePassword: true,
          tutorProfile: {
            create: {
              organizationId: tenantId,
              tutorId: input.tutorId,
              joiningDate: new Date(`${input.joiningDate}T00:00:00.000Z`),
              bio: input.bio,
              expertise: input.expertise,
            },
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId,
          action: 'TUTOR_CREATED',
          targetType: 'User',
          targetId: user.id,
          metadata: { tutorId: input.tutorId, email: input.email },
        },
      });
      return tx.tutorProfile.findFirstOrThrow({ where: { userId: user.id, organizationId: tenantId }, select: tutorSelection });
    });
    return { tutor: serializeTutor(tutor), temporaryPassword: input.temporaryPassword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'Tutor ID or email is already in use in this organization');
    }
    throw error;
  }
}

export async function updateTutor(organizationId: string | null, userId: string, actorId: string, input: TutorUpdate) {
  const tenantId = requireOrganizationId(organizationId);
  const current = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR } } },
    select: { id: true, userId: true },
  });
  if (!current) throw new HttpError(404, 'Tutor not found');
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
      if (input.tutorId !== undefined || input.joiningDate !== undefined || input.bio !== undefined || input.expertise !== undefined) {
        await tx.tutorProfile.update({
          where: { id: current.id },
          data: {
            ...(input.tutorId !== undefined ? { tutorId: input.tutorId } : {}),
            ...(input.joiningDate !== undefined ? { joiningDate: new Date(`${input.joiningDate}T00:00:00.000Z`) } : {}),
            ...(input.bio !== undefined ? { bio: input.bio } : {}),
            ...(input.expertise !== undefined ? { expertise: input.expertise } : {}),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId,
          action: 'TUTOR_UPDATED',
          targetType: 'User',
          targetId: current.userId,
          metadata: { changedFields: Object.keys(input) },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'Tutor ID or email is already in use in this organization');
    }
    throw error;
  }
  return getTutor(tenantId, userId);
}

async function setTutorStatus(
  organizationId: string | null,
  userId: string,
  actorId: string,
  status: typeof AccountStatus.APPROVED | typeof AccountStatus.SUSPENDED,
) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR } } },
    select: { id: true, user: { select: { status: true, accountRegistration: { select: { id: true } } } } },
  });
  if (!profile) throw new HttpError(404, 'Tutor not found');
  if (status === AccountStatus.SUSPENDED && profile.user.status !== AccountStatus.APPROVED) {
    throw new HttpError(409, 'Only approved Tutors can be suspended');
  }
  if (status === AccountStatus.APPROVED && profile.user.status !== AccountStatus.SUSPENDED) {
    throw new HttpError(409, 'Only suspended Tutors can be reactivated');
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId, organizationId: tenantId, role: Role.TUTOR, status: profile.user.status },
      data: { status, rejectionReason: null },
    });
    if (updated.count !== 1) throw new HttpError(409, 'Tutor status changed; refresh and try again');
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
        action: status === AccountStatus.SUSPENDED ? 'TUTOR_SUSPENDED' : 'TUTOR_REACTIVATED',
        targetType: 'User',
        targetId: userId,
        metadata: {},
      },
    });
  });
  return getTutor(tenantId, userId);
}

export function suspendTutor(organizationId: string | null, userId: string, actorId: string) {
  return setTutorStatus(organizationId, userId, actorId, AccountStatus.SUSPENDED);
}

export function reactivateTutor(organizationId: string | null, userId: string, actorId: string) {
  return setTutorStatus(organizationId, userId, actorId, AccountStatus.APPROVED);
}

export async function uploadTutorPhoto(
  organizationId: string | null,
  userId: string,
  actorId: string,
  actorRole: Role,
  buffer: Buffer,
) {
  const tenantId = requireOrganizationId(organizationId);
  if (actorRole === Role.TUTOR && userId !== actorId) throw new HttpError(403, 'Tutors can only update their own profile photo');
  const profile = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR } } },
    select: { photoStorageKey: true },
  });
  if (!profile) throw new HttpError(404, 'Tutor not found');
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !['png', 'jpg', 'webp'].includes(detected.ext)) {
    throw new HttpError(400, 'Profile photos must be PNG, JPG, or WEBP images');
  }
  const storageKey = await tutorPhotoStorage.save(buffer, `.${detected.ext}`);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.tutorProfile.updateMany({
        where: { organizationId: tenantId, userId },
        data: { photoStorageKey: storageKey },
      });
      await tx.auditLog.create({
        data: { organizationId: tenantId, actorId, action: 'TUTOR_PROFILE_PHOTO_UPDATED', targetType: 'User', targetId: userId, metadata: {} },
      });
    });
  } catch (error) {
    await tutorPhotoStorage.remove(storageKey);
    throw error;
  }
  if (profile.photoStorageKey) {
    try {
      await tutorPhotoStorage.remove(profile.photoStorageKey);
    } catch (error) {
      logger.error({ err: error, userId, organizationId: tenantId }, 'Unable to remove the replaced tutor profile photo');
    }
  }
  return { photoUrl: `/tutors/${userId}/photo` };
}

export async function getTutorPhoto(organizationId: string | null, userId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const profile = await prisma.tutorProfile.findFirst({
    where: { userId, organizationId: tenantId, user: { is: { organizationId: tenantId, role: Role.TUTOR, status: AccountStatus.APPROVED, isActive: true } } },
    select: { photoStorageKey: true },
  });
  if (!profile?.photoStorageKey) throw new HttpError(404, 'Tutor profile photo not found');
  const file = await tutorPhotoStorage.open(profile.photoStorageKey);
  const extension = profile.photoStorageKey.split('.').pop();
  const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  return { ...file, mimeType };
}
