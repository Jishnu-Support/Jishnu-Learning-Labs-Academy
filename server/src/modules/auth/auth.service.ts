import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { Role, StudentStatus, type User } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { hashToken, makeAccessToken, makeRefreshToken } from '../../utils/tokens.js';

type RequestMeta = { ip: string | undefined; userAgent: string | undefined };
type Credentials = { user: User; accessToken: string; refreshToken: string };

async function recordLogin(userId: string | null, meta: RequestMeta, success: boolean): Promise<void> {
  await prisma.loginLog.create({ data: { userId, ip: meta.ip, userAgent: meta.userAgent, success } });
}

async function issueCredentials(user: User, meta: RequestMeta): Promise<Credentials> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * env.REFRESH_TOKEN_TTL_DAYS);
  const refreshToken = makeRefreshToken(user.id, user.role, sessionId);
  await prisma.$transaction(async (tx) => {
    if (user.role === Role.STUDENT) {
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await tx.session.create({ data: { id: sessionId, userId: user.id, refreshTokenHash: hashToken(refreshToken), ip: meta.ip, userAgent: meta.userAgent, expiresAt } });
  }, { isolationLevel: 'Serializable' });
  return { user, accessToken: makeAccessToken(user.id, user.role, sessionId), refreshToken };
}

function roleMatches(actual: Role, expected: 'INSTRUCTOR' | 'STAFF'): boolean {
  return expected === 'STAFF' ? actual === Role.STAFF || actual === Role.SUPER_ADMIN : actual === Role.INSTRUCTOR;
}

export async function registerStudent(input: { studentId: string; name: string; email: string; password: string }) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        role: Role.STUDENT,
        studentProfile: { create: { studentId: input.studentId, status: StudentStatus.PENDING } },
      },
      select: { id: true, email: true, name: true, role: true, studentProfile: { select: { studentId: true, status: true } } },
    });
    return user;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new HttpError(409, 'Email or Student ID is already registered');
    }
    throw error;
  }
}

export async function loginStudent(input: { studentId: string; password: string }, meta: RequestMeta): Promise<Credentials> {
  const profile = await prisma.studentProfile.findUnique({ where: { studentId: input.studentId }, include: { user: true } });
  const user = profile?.user;
  if (!user || !profile) {
    await recordLogin(null, meta, false);
    throw new HttpError(401, 'Student ID or password is incorrect');
  }
  const validPassword = await bcrypt.compare(input.password, user.passwordHash);
  if (!validPassword || !user.isActive) {
    await recordLogin(user.id, meta, false);
    throw new HttpError(401, 'Student ID or password is incorrect');
  }
  if (profile.status === StudentStatus.PENDING) {
    await recordLogin(user.id, meta, false);
    throw new HttpError(403, 'Your registration is pending instructor approval');
  }
  if (profile.status === StudentStatus.REJECTED) {
    await recordLogin(user.id, meta, false);
    throw new HttpError(403, profile.rejectionReason ? `Your registration was rejected: ${profile.rejectionReason}` : 'Your registration was rejected');
  }
  if (profile.status === StudentStatus.SUSPENDED) {
    await recordLogin(user.id, meta, false);
    throw new HttpError(403, 'Your student account is suspended');
  }
  await recordLogin(user.id, meta, true);
  return issueCredentials(user, meta);
}

export async function loginPortal(input: { email: string; password: string }, portal: 'INSTRUCTOR' | 'STAFF', meta: RequestMeta): Promise<Credentials> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    await recordLogin(null, meta, false);
    throw new HttpError(401, 'Email or password is incorrect');
  }
  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid || !user.isActive || !roleMatches(user.role, portal)) {
    await recordLogin(user.id, meta, false);
    throw new HttpError(401, 'Email or password is incorrect');
  }
  await recordLogin(user.id, meta, true);
  return issueCredentials(user, meta);
}

export async function refreshSession(refreshToken: string | undefined): Promise<Credentials> {
  if (!refreshToken) throw new HttpError(401, 'Refresh token required');
  const { verifyRefreshToken } = await import('../../utils/tokens.js');
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw new HttpError(401, 'Invalid or expired refresh token');
  }
  const session = await prisma.session.findUnique({ where: { id: claims.sid }, include: { user: true } });
  if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date() || session.refreshTokenHash !== hashToken(refreshToken) || !session.user.isActive) {
    throw new HttpError(401, 'Invalid or expired refresh token');
  }
  const nextRefresh = makeRefreshToken(session.user.id, session.user.role, session.id);
  await prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: hashToken(nextRefresh) } });
  return { user: session.user, accessToken: makeAccessToken(session.user.id, session.user.role, session.id), refreshToken: nextRefresh };
}

export async function logoutSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}
