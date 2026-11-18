import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import {
  AccountStatus, CourseStatus, NotificationType, OrganizationStatus, Prisma, RegistrationPaymentMethod,
  RegistrationPaymentStatus, Role, StudentStatus, type User,
} from '@prisma/client';
import type { Express } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { hashToken, makeAccessToken, makeRefreshToken, verifyRefreshToken } from '../../utils/tokens.js';
import { encryptIdentifier } from '../students/student-identifiers.crypto.js';
import { notifyAfterCommit, notifyUsers } from '../notifications/notifications.service.js';
import { removeRegistrationReceipt, saveRegistrationReceipt } from '../payments/registration-receipt.service.js';

type RequestMeta = { ip: string | undefined; userAgent: string | undefined };
type Credentials = { user: User; accessToken: string; refreshToken: string };
type TenantLogin = { organizationCode: string; password: string; identifier: string };

async function recordLogin(
  userId: string | null,
  organizationId: string | null,
  meta: RequestMeta,
  success: boolean,
): Promise<void> {
  await prisma.loginLog.create({ data: { userId, organizationId, ip: meta.ip, userAgent: meta.userAgent, success } });
}

async function withRetryableTransaction<T>(operation: () => Promise<T>): Promise<T> {
  let attempts = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!retryable || attempts >= 3) throw error;
      attempts += 1;
    }
  }
}

async function issueCredentials(user: User, meta: RequestMeta): Promise<Credentials> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * env.REFRESH_TOKEN_TTL_DAYS);
  const refreshToken = makeRefreshToken(user.id, user.role, sessionId, user.organizationId);
  await withRetryableTransaction(async () => {
    await prisma.$transaction(async (tx) => {
      if (user.role === Role.STUDENT) {
        await tx.session.updateMany({
          where: { userId: user.id, organizationId: user.organizationId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.session.create({
        data: {
          id: sessionId,
          userId: user.id,
          organizationId: user.organizationId,
          refreshTokenHash: hashToken(refreshToken),
          ip: meta.ip,
          userAgent: meta.userAgent,
          expiresAt,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });
  return {
    user,
    accessToken: makeAccessToken(user.id, user.role, sessionId, user.organizationId),
    refreshToken,
  };
}

function statusMessage(user: User): string {
  if (user.status === AccountStatus.PENDING_PAYMENT) {
    return 'Your registration is awaiting payment verification. Use the registration status page or contact your organization.';
  }
  if (user.status === AccountStatus.PENDING) {
    const roleLabel = user.role === Role.TUTOR ? 'Tutor' : user.role.toLowerCase().replace('_', ' ');
    const approver = user.role === Role.STUDENT ? 'Tutor' : 'organization admin';
    return `Your ${roleLabel} registration is pending ${approver} approval`;
  }
  if (user.status === AccountStatus.REJECTED) {
    return user.rejectionReason ? `Your registration was rejected: ${user.rejectionReason}` : 'Your registration was rejected';
  }
  return `Your ${user.role.toLowerCase().replace('_', ' ')} account is suspended`;
}

async function findTenantAccount(role: Role, organizationId: string, identifier: string): Promise<User | null> {
  if (role === Role.STUDENT) {
    return prisma.user.findFirst({
      where: {
        organizationId,
        role,
        studentProfile: { is: { organizationId, studentId: identifier } },
      },
    });
  }
  if (role === Role.TUTOR && !identifier.includes('@')) {
    return prisma.user.findFirst({
      where: { organizationId, role, tutorProfile: { is: { organizationId, tutorId: identifier } } },
    });
  }
  return prisma.user.findFirst({
    where: { organizationId, role, email: identifier.toLowerCase() },
  });
}

async function loginTenant(role: Role, input: TenantLogin, meta: RequestMeta): Promise<Credentials> {
  const organization = await prisma.organization.findFirst({
    where: { code: input.organizationCode },
    select: { id: true, status: true },
  });
  if (!organization) {
    await recordLogin(null, null, meta, false);
    throw new HttpError(401, 'Organization code or credentials are incorrect');
  }
  if (organization.status !== OrganizationStatus.ACTIVE && organization.status !== OrganizationStatus.APPROVED) {
    await recordLogin(null, organization.id, meta, false);
    if (organization.status === OrganizationStatus.SUSPENDED) {
      throw new HttpError(403, 'This organization is suspended. Contact the platform administrator.');
    }
    if (organization.status === OrganizationStatus.PENDING) {
      throw new HttpError(403, 'This organization is pending Super Admin approval.');
    }
    throw new HttpError(403, 'This organization registration was rejected.');
  }

  const user = await findTenantAccount(role, organization.id, input.identifier);
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    await recordLogin(user?.id ?? null, organization.id, meta, false);
    throw new HttpError(401, 'ID/email or password is incorrect');
  }
  if (!user.isActive || user.status !== AccountStatus.APPROVED) {
    await recordLogin(user.id, organization.id, meta, false);
    throw new HttpError(403, statusMessage(user));
  }

  await recordLogin(user.id, organization.id, meta, true);
  return issueCredentials(user, meta);
}

export async function getRegistrationOptions(organizationCode: string) {
  const organization = await prisma.organization.findFirst({
    where: {
      code: organizationCode,
      status: { in: [OrganizationStatus.ACTIVE, OrganizationStatus.APPROVED] },
    },
    select: { id: true, currency: true },
  });
  if (!organization) throw new HttpError(404, 'Active organization not found');
  const courses = await prisma.course.findMany({
    where: {
      organizationId: organization.id,
      status: CourseStatus.PUBLISHED,
      registrationMonthlyFee: { gt: 0 },
    },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, category: true, registrationMonthlyFee: true },
  });
  return {
    courses: courses.map((course) => ({
      ...course,
      registrationMonthlyFee: course.registrationMonthlyFee?.toNumber() ?? null,
    })),
    currency: organization.currency,
    identityCollectionEnabled: Boolean(env.PII_ENCRYPTION_KEY),
    aadhaarEnabled: env.ENABLE_AADHAAR_FIELD && Boolean(env.PII_ENCRYPTION_KEY),
  };
}

type RegistrationDetails = {
  organizationCode: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  fatherName: string;
  motherName: string;
  aadhaarNumber?: string;
  apaarId?: string;
  interestedCourseId: string;
  piiConsent: boolean;
  termsAccepted: boolean;
  paymentMethod: RegistrationPaymentMethod;
  transactionReference: string;
  reportedPaid: boolean;
};

async function getSelectedCourse(organizationId: string, courseId: string) {
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      organizationId,
      status: CourseStatus.PUBLISHED,
      registrationMonthlyFee: { gt: 0 },
    },
    select: { id: true, title: true, category: true, registrationMonthlyFee: true },
  });
  if (!course) {
    throw new HttpError(400, 'Choose a published course with a configured registration fee in your organization');
  }
  return course;
}

function registrationProfileFields(input: RegistrationDetails, courseTitle: string) {
  return {
    fatherName: input.fatherName,
    motherName: input.motherName,
    interestedCourse: courseTitle,
    aadhaarEncrypted: input.aadhaarNumber ? encryptIdentifier(input.aadhaarNumber) : null,
    aadhaarLast4: input.aadhaarNumber?.slice(-4) ?? null,
    apaarIdEncrypted: input.apaarId ? encryptIdentifier(input.apaarId) : null,
    apaarIdLast4: input.apaarId?.slice(-4) ?? null,
    piiConsentAt: input.piiConsent ? new Date() : null,
    termsAcceptedAt: new Date(),
  };
}

export async function registerStudent(input: RegistrationDetails & {
  studentId: string;
  receipt?: Express.Multer.File;
}) {
  const organization = await prisma.organization.findFirst({
    where: { code: input.organizationCode, status: { in: [OrganizationStatus.ACTIVE, OrganizationStatus.APPROVED] } },
  });
  if (!organization) throw new HttpError(404, 'Active organization not found');
  const course = await getSelectedCourse(organization.id, input.interestedCourseId);
  const registrationFee = course.registrationMonthlyFee;
  if (!registrationFee) throw new HttpError(409, 'This course does not have a registration fee configured');
  const courseLabel = `${course.category} — ${course.title}`;
  const registrationAccessToken = randomBytes(32).toString('hex');
  const statusTokenHash = createHash('sha256').update(registrationAccessToken).digest('hex');
  const passwordHash = await bcrypt.hash(input.password, 12);
  const receipt = await saveRegistrationReceipt(input.receipt);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          name: input.name,
          phone: `+91${input.phone}`,
          passwordHash,
          role: Role.STUDENT,
          status: AccountStatus.PENDING_PAYMENT,
          studentProfile: {
            create: {
              organizationId: organization.id,
              studentId: input.studentId,
              status: StudentStatus.PENDING,
              ...registrationProfileFields(input, courseLabel),
            },
          },
        },
        select: { id: true, email: true, name: true, role: true, status: true, studentProfile: { select: { studentId: true } } },
      });
      const registrationPayment = await tx.registrationPayment.create({
        data: {
          organizationId: organization.id,
          applicantId: user.id,
          applicantRole: Role.STUDENT,
          courseId: course.id,
          amount: registrationFee,
          currency: organization.currency,
          paymentMethod: input.paymentMethod,
          transactionReference: input.transactionReference,
          receiptStorageKey: receipt?.storageKey,
          receiptOriginalName: receipt?.originalName,
          reportedPaid: input.reportedPaid,
          status: RegistrationPaymentStatus.PENDING,
          statusTokenHash,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          action: 'STUDENT_REGISTRATION_PAYMENT_CREATED',
          targetType: 'RegistrationPayment',
          targetId: registrationPayment.id,
          metadata: { courseId: course.id, amount: registrationFee.toNumber(), currency: organization.currency },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          action: 'ACCOUNT_CREATED',
          targetType: 'User',
          targetId: user.id,
          metadata: { role: Role.STUDENT, courseId: course.id, registrationPaymentRequired: true },
        },
      });
      return user;
    });
    await notifyAfterCommit(async () => {
      const admins = await prisma.user.findMany({
        where: { organizationId: organization.id, role: Role.ORG_ADMIN, status: AccountStatus.APPROVED, isActive: true },
        select: { id: true },
      });
      await notifyUsers(organization.id, admins.map(({ id }) => id), {
        type: NotificationType.ACCOUNT_PENDING,
        title: 'Student registration payment pending',
        body: `A Student submitted payment details for ${course.title}. Verify payment to activate the account.`,
        link: '/org-admin/payments',
        dedupeKey: `student-registration-payment:${user.id}`,
      });
    }, 'student registration');
    return { user, registrationAccessToken };
  } catch (error) {
    await removeRegistrationReceipt(receipt?.storageKey);
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new HttpError(409, 'Email or Student ID is already registered in this organization');
    }
    throw error;
  }
}

export async function registerTutor(input: {
  organizationCode: string;
  tutorId: string;
} & RegistrationDetails & { receipt?: Express.Multer.File }) {
  return registerPendingAccount(input);
}

async function registerPendingAccount(
  input: RegistrationDetails & { tutorId: string; receipt?: Express.Multer.File },
) {
  const organization = await prisma.organization.findFirst({
    where: { code: input.organizationCode, status: { in: [OrganizationStatus.ACTIVE, OrganizationStatus.APPROVED] } },
  });
  if (!organization) throw new HttpError(404, 'Active organization not found');
  const selectedCourse = await getSelectedCourse(organization.id, input.interestedCourseId);
  const registrationFee = selectedCourse.registrationMonthlyFee;
  if (!registrationFee) throw new HttpError(409, 'This course does not have a registration fee configured');
  const courseLabel = `${selectedCourse.category} — ${selectedCourse.title}`;
  const passwordHash = await bcrypt.hash(input.password, 12);
  const receipt = await saveRegistrationReceipt(input.receipt);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          name: input.name,
          phone: `+91${input.phone}`,
          passwordHash,
          role: Role.TUTOR,
          status: AccountStatus.PENDING_PAYMENT,
          tutorProfile: {
            create: {
              organizationId: organization.id,
              tutorId: requireTutorId(input.tutorId),
              ...registrationProfileFields(input, courseLabel),
            },
          },
          accountRegistration: {
            create: { organizationId: organization.id, status: StudentStatus.PENDING },
          },
        },
        select: { id: true, email: true, name: true, role: true, status: true, tutorProfile: { select: { tutorId: true } } },
      });
      await tx.registrationPayment.create({
        data: {
          organizationId: organization.id,
          applicantId: user.id,
          applicantRole: Role.TUTOR,
          courseId: selectedCourse.id,
          statusTokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
          amount: registrationFee,
          currency: organization.currency,
          paymentMethod: input.paymentMethod,
          transactionReference: input.transactionReference,
          receiptStorageKey: receipt?.storageKey,
          receiptOriginalName: receipt?.originalName,
          reportedPaid: input.reportedPaid,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          action: 'ACCOUNT_CREATED',
          targetType: 'User',
          targetId: user.id,
          metadata: { role: Role.TUTOR },
        },
      });
      return user;
    });
    await notifyAfterCommit(async () => {
      const approvers = await prisma.user.findMany({
        where: { organizationId: organization.id, role: Role.ORG_ADMIN, status: AccountStatus.APPROVED, isActive: true },
        select: { id: true },
      });
      await notifyUsers(organization.id, approvers.map(({ id }) => id), {
        type: NotificationType.ACCOUNT_PENDING,
        title: 'Tutor registration payment pending verification',
        body: `${user.name} submitted payment details for ${selectedCourse.title}. Verify payment before manually approving the Tutor registration.`,
        link: '/org-admin/payments',
        dedupeKey: `tutor-registration-payment:${user.id}`,
      });
    }, 'Tutor registration');
    return user;
  } catch (error) {
    await removeRegistrationReceipt(receipt?.storageKey);
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new HttpError(409, 'Email or Tutor ID is already registered in this organization');
    }

    throw error;
  }
}

export async function getStudentRegistrationStatus(token: string) {
  const statusTokenHash = createHash('sha256').update(token).digest('hex');
  const payment = await prisma.registrationPayment.findUnique({
    where: { statusTokenHash, applicantRole: Role.STUDENT },
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      paymentMethod: true,
      transactionReference: true,
      createdAt: true,
      paidAt: true,
      refundedAt: true,
      course: { select: { title: true, code: true } },
      applicant: {
        select: {
          status: true,
          rejectionReason: true,
          organization: { select: { name: true, contactNumber: true } },
        },
      },
    },
  });
  if (!payment || !payment.applicant.organization) throw new HttpError(404, 'Registration status not found');
  return {
    registrationReference: payment.id,
    course: payment.course,
    amount: payment.amount.toNumber(),
    currency: payment.currency,
    paymentStatus: payment.status,
    paymentMethod: payment.paymentMethod,
    transactionReference: payment.transactionReference,
    accountStatus: payment.applicant.status,
    rejectionReason: payment.applicant.status === AccountStatus.REJECTED ? payment.applicant.rejectionReason : null,
    organization: payment.applicant.organization,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
    refundedAt: payment.refundedAt,
  };
}

function requireTutorId(tutorId: string | undefined): string {
  if (!tutorId || !/^TUT-[A-Z0-9-]+$/i.test(tutorId)) throw new HttpError(400, 'Use a Tutor ID starting with TUT-');
  return tutorId;
}

export function loginStudent(input: { organizationCode: string; studentId: string; password: string }, meta: RequestMeta) {
  return loginTenant(Role.STUDENT, { ...input, identifier: input.studentId }, meta);
}

export function loginOrgAdmin(input: { organizationCode: string; email: string; password: string }, meta: RequestMeta) {
  return loginTenant(Role.ORG_ADMIN, { ...input, identifier: input.email }, meta);
}

export async function loginTutor(input: { organizationCode: string; identifier: string; password: string }, meta: RequestMeta): Promise<Credentials> {
  const organization = await prisma.organization.findFirst({
    where: { code: input.organizationCode },
    select: { id: true, status: true },
  });
  if (!organization) {
    await recordLogin(null, null, meta, false);
    throw new HttpError(401, 'Organization code or credentials are incorrect');
  }
  if (organization.status !== OrganizationStatus.ACTIVE && organization.status !== OrganizationStatus.APPROVED) {
    await recordLogin(null, organization.id, meta, false);
    if (organization.status === OrganizationStatus.SUSPENDED) throw new HttpError(403, 'This organization is suspended. Contact the platform administrator.');
    if (organization.status === OrganizationStatus.PENDING) throw new HttpError(403, 'This organization is pending Super Admin approval.');
    throw new HttpError(403, 'This organization registration was rejected.');
  }
  const user = await findTenantAccount(Role.TUTOR, organization.id, input.identifier);
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    await recordLogin(user?.id ?? null, organization.id, meta, false);
    throw new HttpError(401, 'Tutor ID/email or password is incorrect');
  }
  if (!user.isActive || user.status !== AccountStatus.APPROVED) {
    await recordLogin(user.id, organization.id, meta, false);
    throw new HttpError(403, statusMessage(user));
  }
  await recordLogin(user.id, organization.id, meta, true);
  return issueCredentials(user, meta);
}

export async function loginSuperAdmin(input: { email: string; password: string }, meta: RequestMeta): Promise<Credentials> {
  const user = await prisma.user.findFirst({
    where: { email: input.email, role: Role.SUPER_ADMIN, organizationId: null },
  });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    await recordLogin(user?.id ?? null, null, meta, false);
    throw new HttpError(401, 'Email or password is incorrect');
  }
  if (!user.isActive || user.status !== AccountStatus.APPROVED) {
    await recordLogin(user.id, null, meta, false);
    throw new HttpError(403, statusMessage(user));
  }
  await recordLogin(user.id, null, meta, true);
  return issueCredentials(user, meta);
}

export async function refreshSession(refreshToken: string | undefined): Promise<Credentials> {
  if (!refreshToken) throw new HttpError(401, 'Refresh token required');
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw new HttpError(401, 'Invalid or expired refresh token');
  }
  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    include: { user: { include: { organization: true } } },
  });
  if (
    !session ||
    session.userId !== claims.sub ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.refreshTokenHash !== hashToken(refreshToken) ||
    !session.user.isActive ||
    session.user.status !== AccountStatus.APPROVED ||
    (session.user.organization && session.user.organization.status !== OrganizationStatus.ACTIVE &&
      session.user.organization.status !== OrganizationStatus.APPROVED) ||
    session.organizationId !== session.user.organizationId ||
    claims.organizationId !== session.user.organizationId ||
    claims.role !== session.user.role
  ) {
    if (session?.user.organization?.status === OrganizationStatus.SUSPENDED) {
      throw new HttpError(403, 'This organization is suspended. Contact the platform administrator.');
    }
    throw new HttpError(401, 'Invalid or expired refresh token');
  }
  const nextRefresh = makeRefreshToken(session.user.id, session.user.role, session.id, session.user.organizationId);
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: hashToken(nextRefresh) },
  });
  return {
    user: session.user,
    accessToken: makeAccessToken(session.user.id, session.user.role, session.id, session.user.organizationId),
    refreshToken: nextRefresh,
  };
}

export async function logoutSession(sessionId: string, organizationId: string | null): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function changeTemporaryPassword(
  userId: string,
  organizationId: string | null,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, passwordHash: true, mustChangePassword: true },
  });
  if (!user || !user.mustChangePassword) throw new HttpError(409, 'This account does not require a temporary password change');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new HttpError(400, 'Current password is incorrect');
  if (await bcrypt.compare(newPassword, user.passwordHash)) throw new HttpError(400, 'Choose a password different from the temporary password');

  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: user.id, organizationId, mustChangePassword: true },
      data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false },
    });
    if (updated.count !== 1) throw new HttpError(409, 'This account no longer requires a temporary password change');
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: user.id,
        action: 'TEMPORARY_PASSWORD_CHANGED',
        targetType: 'User',
        targetId: user.id,
        metadata: {},
      },
    });
  });
}
