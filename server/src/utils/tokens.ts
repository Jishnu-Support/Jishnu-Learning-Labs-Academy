import { createHash } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env.js';

export type TokenClaims = JwtPayload & { sub: string; role: Role; sid: string; organizationId: string | null };

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function makeAccessToken(userId: string, role: Role, sessionId: string, organizationId: string | null): string {
  return jwt.sign({ role, sid: sessionId, organizationId }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function makeRefreshToken(userId: string, role: Role, sessionId: string, organizationId: string | null): string {
  return jwt.sign({ role, sid: sessionId, organizationId }, env.JWT_REFRESH_SECRET, {
    subject: userId,
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

export function verifyAccessToken(token: string): TokenClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenClaims;
}

export function verifyRefreshToken(token: string): TokenClaims {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenClaims;
}
