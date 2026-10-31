import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import * as authService from './auth.service.js';

const accessCookie = 'accessToken';
const refreshCookie = 'refreshToken';
const cookieBase = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
const refreshCookieOptions = { ...cookieBase, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 };

function setAuthCookies(res: Parameters<RequestHandler>[1], accessToken: string, refreshToken: string): void {
  res.cookie(accessCookie, accessToken, cookieBase);
  res.cookie(refreshCookie, refreshToken, refreshCookieOptions);
}

function requestMeta(req: Parameters<RequestHandler>[0]) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

export const registerStudent: RequestHandler = async (req, res) => {
  const user = await authService.registerStudent(req.body);
  res.status(201).json({ data: { user, message: 'Registration submitted. An instructor must approve your account before you can sign in.' } });
};

export const studentLogin: RequestHandler = async (req, res) => {
  const credentials = await authService.loginStudent(req.body, requestMeta(req));
  setAuthCookies(res, credentials.accessToken, credentials.refreshToken);
  res.json({ data: { user: { id: credentials.user.id, email: credentials.user.email, name: credentials.user.name, role: credentials.user.role } } });
};

export function portalLogin(portal: 'INSTRUCTOR' | 'STAFF'): RequestHandler {
  return async (req, res) => {
    const credentials = await authService.loginPortal(req.body, portal, requestMeta(req));
    setAuthCookies(res, credentials.accessToken, credentials.refreshToken);
    res.json({ data: { user: { id: credentials.user.id, email: credentials.user.email, name: credentials.user.name, role: credentials.user.role } } });
  };
}

export const refresh: RequestHandler = async (req, res) => {
  const credentials = await authService.refreshSession(req.cookies?.refreshToken as string | undefined);
  setAuthCookies(res, credentials.accessToken, credentials.refreshToken);
  res.json({ data: { user: { id: credentials.user.id, email: credentials.user.email, name: credentials.user.name, role: credentials.user.role } } });
};

export const logout: RequestHandler = async (req, res) => {
  if (req.auth) await authService.logoutSession(req.auth.sessionId);
  res.clearCookie(accessCookie, cookieBase);
  res.clearCookie(refreshCookie, cookieBase);
  res.status(204).end();
};

export const me: RequestHandler = async (req, res) => {
  const { prisma } = await import('../../config/prisma.js');
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, email: true, name: true, role: true } });
  res.json({ data: { user } });
};
