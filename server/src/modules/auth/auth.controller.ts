import type { Request, RequestHandler, Response } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import * as authService from './auth.service.js';

const accessCookie = 'accessToken';
const refreshCookie = 'refreshToken';
const cookieBase = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
const refreshCookieOptions = { ...cookieBase, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 };

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(accessCookie, accessToken, cookieBase);
  res.cookie(refreshCookie, refreshToken, refreshCookieOptions);
}

function requestMeta(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

function loginResponse(res: Response, credentials: Awaited<ReturnType<typeof authService.loginStudent>>): void {
  setAuthCookies(res, credentials.accessToken, credentials.refreshToken);
  res.json({
    data: {
      user: {
        id: credentials.user.id,
        organizationId: credentials.user.organizationId,
        email: credentials.user.email,
        name: credentials.user.name,
        role: credentials.user.role,
        mustChangePassword: credentials.user.mustChangePassword,
      },
    },
  });
}

export const registerStudent: RequestHandler = async (req, res) => {
  const user = await authService.registerStudent(req.body);
  res.status(201).json({ data: { user, message: 'Registration submitted. An instructor must approve your account before you can sign in.' } });
};

export const registerInstructor: RequestHandler = async (req, res) => {
  const user = await authService.registerInstructor(req.body);
  res.status(201).json({ data: { user, message: 'Registration submitted. An organization admin must approve your account before you can sign in.' } });
};

export const registerStaff: RequestHandler = async (req, res) => {
  const user = await authService.registerStaff(req.body);
  res.status(201).json({ data: { user, message: 'Registration submitted. An instructor must approve your account before you can sign in.' } });
};

export const studentLogin: RequestHandler = async (req, res) => {
  loginResponse(res, await authService.loginStudent(req.body, requestMeta(req)));
};

export const instructorLogin: RequestHandler = async (req, res) => {
  loginResponse(res, await authService.loginInstructor(req.body, requestMeta(req)));
};

export const orgAdminLogin: RequestHandler = async (req, res) => {
  loginResponse(res, await authService.loginOrgAdmin(req.body, requestMeta(req)));
};

export const staffLogin: RequestHandler = async (req, res) => {
  loginResponse(res, await authService.loginStaff(req.body, requestMeta(req)));
};

export const superAdminLogin: RequestHandler = async (req, res) => {
  loginResponse(res, await authService.loginSuperAdmin(req.body, requestMeta(req)));
};

export const refresh: RequestHandler = async (req, res) => {
  const credentials = await authService.refreshSession(req.cookies?.refreshToken as string | undefined);
  loginResponse(res, credentials);
};

export const logout: RequestHandler = async (req, res) => {
  if (req.auth) await authService.logoutSession(req.auth.sessionId, req.auth.organizationId);
  res.clearCookie(accessCookie, cookieBase);
  res.clearCookie(refreshCookie, cookieBase);
  res.status(204).end();
};

export const me: RequestHandler = async (req, res) => {
  const user = await prisma.user.findFirst({
    where: { id: req.auth!.userId, organizationId: req.auth!.organizationId },
    select: {
      id: true,
      organizationId: true,
      email: true,
      name: true,
      role: true,
      status: true,
      mustChangePassword: true,
      studentProfile: { select: { studentId: true } },
    },
  });
  if (!user) {
    res.json({ data: { user: null } });
    return;
  }
  const { studentProfile, ...safeUser } = user;
  res.json({ data: { user: { ...safeUser, studentId: user.role === 'STUDENT' ? studentProfile?.studentId : undefined } } });
};

export const changePassword: RequestHandler = async (req, res) => {
  await authService.changeTemporaryPassword(
    req.auth!.userId,
    req.auth!.organizationId,
    req.body.currentPassword,
    req.body.newPassword,
  );
  res.json({ data: { message: 'Your password has been changed' } });
};
