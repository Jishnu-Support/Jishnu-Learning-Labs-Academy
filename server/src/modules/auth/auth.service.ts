import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { AccountStatus, OrganizationStatus, Role, StudentStatus, type User } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { hashToken, makeAccessToken, makeRefreshToken, verifyRefreshToken } from '../../utils/tokens.js';

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

async function issueCredentials(user: User, meta: RequestMeta): Promise<Credentials> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * env.REFRESH_TOKEN_TTL_DAYS);
  const refreshToken = makeRefreshToken(user.id, user.role, sessionId, user.organizationId);
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
  }, { isolationLevel: 'Serializable' });
  return {
    user,
    accessToken: makeAccessToken(user.id, user.role, sessionId, user.organizationId),
    refreshToken,
  };
}

function statusMessage(user: User): string {
  if (user.status === AccountStatus.PENDING) {
    const approver = user.role === Role.STUDENT ? 'instructor' : 'organization admin';
    return `Your ${user.role.toLowerCase().replace('_', ' ')} registration is pending ${approver} approval`;
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
  if (role === Role.STAFF && !identifier.includes('@')) {
    return prisma.user.findFirst({
      where: { organizationId, role, staffProfile: { is: { organizationId, staffId: identifier } } },
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

export async function registerStudent(input: {
  organizationCode: string;
  studentId: string;
  name: string;
  email: string;
  phone: string;
  password: string;
}) {
  const organization = await prisma.organization.findFirst({
    where: { code: input.organizationCode, status: { in: [OrganizationStatus.ACTIVE, OrganizationStatus.APPROVED] } },
  });
  if (!organization) throw new HttpError(404, 'Active organization not found');
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          name: input.name,
          phone: input.phone,
          passwordHash,
          role: Role.STUDENT,
          status: AccountStatus.PENDING,
          studentProfile: {
            create: { organizationId: organization.id, studentId: input.studentId, status: StudentStatus.PENDING },
          },
        },
        select: { id: true, email: true, name: true, role: true, status: true, studentProfile: { select: { studentId: true } } },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          action: 'ACCOUNT_CREATED',
          targetType: 'User',
          targetId: user.id,
          metadata: { role: Role.STUDENT },
        },
      });
      return user;
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new HttpError(409, 'Email or Student ID is already registered in this organization');
    }
    throw error;
  }
}

export async function registerInstructor(input: {
  organizationCode: string;
  name: string;
  email: string;
  phone: string;
  password: string;
}) {
  return registerPendingAccount(input, Role.INSTRUCTOR);
}

export async function registerStaff(input: {
  organizationCode: string;
  staffId: string;
  name: string;
  email: string;
  phone: string;
  password: string;
}) {
  const user = await registerPendingAccount(input, Role.STAFF);
  return user;
}

async function registerPendingAccount(
  input: { organizationCode: string; name: string; email: string; phone: string; password: string; staffId?: string },
  role: typeof Role.INSTRUCTOR | typeof Role.STAFF,
) {
  const organization = await prisma.organization.findFirst({
    where: { code: input.organizationCode, status: { in: [OrganizationStatus.ACTIVE, OrganizationStatus.APPROVED] } },
  });
  if (!organization) throw new HttpError(404, 'Active organization not found');
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          name: input.name,
          phone: input.phone,
          passwordHash,
          role,
          status: AccountStatus.PENDING,
          ...(role === Role.STAFF ? {
            staffProfile: {
              create: {
                organizationId: organization.id,
                staffId: requireStaffId(input.staffId),
              },
            },
          } : {}),
          accountRegistration: {
            create: { organizationId: organization.id, status: StudentStatus.PENDING },
          },
        },
        select: { id: true, email: true, name: true, role: true, status: true, staffProfile: { select: { staffId: true } } },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          action: 'ACCOUNT_CREATED',
          targetType: 'User',
          targetId: user.id,
          metadata: { role },
        },
      });
      return user;
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new HttpError(409, 'Email or staff ID is already registered in this organization');
    }
    throw error;
  }
}

function requireStaffId(staffId: string | undefined): string {
  if (!staffId) throw new HttpError(400, 'Staff ID is required');
  return staffId;
}

export function loginStudent(input: { organizationCode: string; studentId: string; password: string }, meta: RequestMeta) {
  return loginTenant(Role.STUDENT, { ...input, identifier: input.studentId }, meta);
}

export function loginInstructor(input: { organizationCode: string; email: string; password: string }, meta: RequestMeta) {
  return loginTenant(Role.INSTRUCTOR, { ...input, identifier: input.email }, meta);
}

export function loginOrgAdmin(input: { organizationCode: string; email: string; password: string }, meta: RequestMeta) {
  return loginTenant(Role.ORG_ADMIN, { ...input, identifier: input.email }, meta);
}

export function loginStaff(input: { organizationCode: string; identifier: string; password: string }, meta: RequestMeta) {
  return loginTenant(Role.STAFF, input, meta);
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
