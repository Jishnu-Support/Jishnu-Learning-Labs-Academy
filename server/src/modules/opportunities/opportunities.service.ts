import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { openResume, removeResume, saveResume } from './resume.storage.js';

type OpeningInput = { title: string; company: string; description: string; externalUrl: string; closesAt?: string };

function requireOrganizationId(organizationId: string | null): string {
  if (!organizationId) throw new HttpError(403, 'An organization-scoped account is required');
  return organizationId;
}

function serializeOpening<T extends { applications?: Array<{ id: string }> }>(opening: T) {
  const { applications, ...details } = opening;
  return { ...details, hasApplied: Boolean(applications?.length), applicationId: applications?.[0]?.id ?? null };
}

export async function listStudentOpportunities(organizationId: string | null, studentId: string) {
  const tenantId = requireOrganizationId(organizationId);
  const now = new Date();
  const openings = await prisma.jobOpening.findMany({
    where: {
      isActive: true,
      OR: [{ organizationId: tenantId }, { organizationId: null }],
      AND: [{ OR: [{ closesAt: null }, { closesAt: { gt: now } }] }],
    },
    include: { applications: { where: { organizationId: tenantId, studentId }, select: { id: true } } },
    orderBy: [{ postedAt: 'desc' }, { id: 'asc' }],
  });
  return { openings: openings.map(serializeOpening) };
}

export async function listManagedOpportunities(organizationId: string | null, role: Role) {
  const tenantId = role === Role.ORG_ADMIN ? requireOrganizationId(organizationId) : null;
  return prisma.jobOpening.findMany({
    where: tenantId === null ? {} : { organizationId: tenantId },
    include: { _count: { select: { applications: true } } },
    orderBy: [{ postedAt: 'desc' }, { id: 'asc' }],
  });
}

export async function createOpportunity(
  organizationId: string | null,
  actorId: string,
  input: OpeningInput,
) {
  if (organizationId) {
    const organization = await prisma.organization.findFirst({
      where: { id: organizationId, status: { in: ['ACTIVE', 'APPROVED'] } },
      select: { id: true },
    });
    if (!organization) throw new HttpError(404, 'Active organization not found');
  }
  const job = await prisma.$transaction(async (tx) => {
    const opening = await tx.jobOpening.create({
      data: {
        organizationId,
        createdById: actorId,
        title: input.title,
        company: input.company,
        description: input.description,
        externalUrl: input.externalUrl,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'JOB_OPENING_CREATED',
        targetType: 'JobOpening',
        targetId: opening.id,
        metadata: { title: opening.title, company: opening.company },
      },
    });
    return opening;
  });
  return job;
}

export async function createApplication(
  organizationId: string | null,
  studentId: string,
  jobOpeningId: string,
  file: Express.Multer.File | undefined,
) {
  const tenantId = requireOrganizationId(organizationId);
  const resume = await saveResume(file);
  if (!resume) throw new HttpError(400, 'Upload a resume to apply');
  try {
    const opening = await prisma.jobOpening.findFirst({
      where: {
        id: jobOpeningId,
        isActive: true,
        OR: [{ organizationId: tenantId }, { organizationId: null }],
        AND: [{ OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }] }],
      },
      select: { id: true, organizationId: true, title: true },
    });
    if (!opening) throw new HttpError(404, 'This opportunity is no longer available');
    return await prisma.$transaction(async (tx) => {
      const application = await tx.jobApplication.create({
        data: {
          organizationId: tenantId,
          jobOpeningId: opening.id,
          studentId,
          resumeStorageKey: resume.storageKey,
          resumeOriginalName: resume.originalName,
          resumeMimeType: resume.mimeType,
        },
        select: { id: true, jobOpeningId: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: tenantId,
          actorId: studentId,
          action: 'JOB_APPLICATION_SUBMITTED',
          targetType: 'JobApplication',
          targetId: application.id,
          metadata: { jobOpeningId: opening.id },
        },
      });
      return application;
    });
  } catch (error) {
    await removeResume(resume.storageKey);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'You have already applied to this opportunity');
    }
    throw error;
  }
}

export async function listApplications(organizationId: string | null, role: Role) {
  const tenantId = role === Role.ORG_ADMIN ? requireOrganizationId(organizationId) : null;
  return prisma.jobApplication.findMany({
    where: tenantId === null ? {} : { organizationId: tenantId, jobOpening: { is: { OR: [{ organizationId: tenantId }, { organizationId: null }] } } },
    select: {
      id: true,
      createdAt: true,
      resumeOriginalName: true,
      student: { select: { id: true, name: true, email: true, studentProfile: { select: { studentId: true } } } },
      jobOpening: { select: { id: true, title: true, company: true, organizationId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getApplicationResume(
  organizationId: string | null,
  role: Role,
  actorId: string,
  applicationId: string,
) {
  const tenantId = role === Role.ORG_ADMIN ? requireOrganizationId(organizationId) : null;
  const application = await prisma.jobApplication.findFirst({
    where: {
      id: applicationId,
      ...(tenantId ? { organizationId: tenantId } : {}),
    },
    select: { id: true, organizationId: true, resumeStorageKey: true, resumeOriginalName: true },
  });
  if (!application) throw new HttpError(404, 'Application resume not found');
  await prisma.auditLog.create({
    data: {
      organizationId: application.organizationId,
      actorId,
      action: 'JOB_APPLICATION_RESUME_ACCESSED',
      targetType: 'JobApplication',
      targetId: application.id,
      metadata: {},
    },
  });
  return { ...(await openResume(application.resumeStorageKey)), filename: application.resumeOriginalName };
}
