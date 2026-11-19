import { prisma } from '../../config/prisma.js';
import type { z } from 'zod';
import { auditSessionQuerySchema } from './audit.schemas.js';

type AuditSessionQuery = z.infer<typeof auditSessionQuerySchema>;

export async function listSessions(input: AuditSessionQuery) {
  const start = input.from ? new Date(`${input.from}T00:00:00.000Z`) : undefined;
  const end = input.to ? new Date(`${input.to}T00:00:00.000Z`) : undefined;
  if (end) end.setUTCDate(end.getUTCDate() + 1);
  const sessions = await prisma.session.findMany({
    where: {
      ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
      user: {
        is: {
          ...(input.role ? { role: input.role } : {}),
          ...(input.user ? {
            OR: [
              { name: { contains: input.user, mode: 'insensitive' } },
              { email: { contains: input.user, mode: 'insensitive' } },
            ],
          } : {}),
        },
      },
    },
    select: {
      id: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { id: true, name: true, email: true, role: true } },
      organization: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const now = new Date();
  return {
    sessions: sessions.map(({ revokedAt, expiresAt, ...session }) => ({
      ...session,
      logoutAt: revokedAt,
      active: revokedAt === null && expiresAt > now,
    })),
  };
}
