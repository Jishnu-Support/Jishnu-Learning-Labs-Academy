import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { AccountStatus, OrganizationStatus, Role } from '@prisma/client';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../utils/http-error.js';
import { verifyAccessToken } from '../../utils/tokens.js';
import { authorizeLiveSessionConnection } from './student-portal.service.js';

type LivePeer = {
  id: string;
  userId: string;
  name: string;
  role: Role;
  organizationId: string;
  sessionId: string;
};

const descriptionSchema = z.object({
  type: z.enum(['offer', 'answer']),
  sdp: z.string().min(1),
});
const candidateSchema = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});
const signalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), to: z.string().uuid(), description: descriptionSchema.extend({ type: z.literal('offer') }) }),
  z.object({ type: z.literal('answer'), to: z.string().uuid(), description: descriptionSchema.extend({ type: z.literal('answer') }) }),
  z.object({ type: z.literal('ice'), to: z.string().uuid(), candidate: candidateSchema }),
]);

type SignalMessage = z.infer<typeof signalSchema>;
type RoomParticipant = { peer: LivePeer; socket: WebSocket };

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const raw = request.headers.cookie;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function rejectUpgrade(socket: Socket, status: number, message: string): void {
  if (socket.destroyed) return;
  const statusText = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Conflict';
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
  socket.destroy();
}

async function authenticatedPeer(request: IncomingMessage, sessionId: string): Promise<LivePeer> {
  const token = cookieValue(request, 'accessToken');
  if (!token) throw new HttpError(401, 'Authentication required');
  let claims: ReturnType<typeof verifyAccessToken>;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw new HttpError(401, 'Invalid or expired access token');
  }
  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    include: { user: { include: { organization: true } } },
  });
  if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date() ||
    !session.user.isActive || session.user.status !== AccountStatus.APPROVED ||
    session.organizationId !== session.user.organizationId ||
    claims.organizationId !== session.user.organizationId || claims.role !== session.user.role) {
    throw new HttpError(401, 'Session expired. Please sign in again.');
  }
  const organization = session.user.organization;
  if (organization?.status === OrganizationStatus.SUSPENDED) {
    throw new HttpError(403, 'This organization is suspended. Contact the platform administrator.');
  }
  if (organization && organization.status !== OrganizationStatus.ACTIVE && organization.status !== OrganizationStatus.APPROVED) {
    throw new HttpError(403, 'This organization is not active.');
  }
  if (session.user.mustChangePassword) throw new HttpError(403, 'Change your temporary password before continuing');
  if (!session.user.organizationId ||
    (session.user.role !== Role.TUTOR && session.user.role !== Role.ORG_ADMIN && session.user.role !== Role.STUDENT)) {
    throw new HttpError(403, 'You cannot join this live session');
  }

  const peer: LivePeer = {
    id: randomUUID(),
    userId: session.userId,
    name: session.user.name,
    role: session.user.role,
    organizationId: session.user.organizationId,
    sessionId,
  };
  await authorizeLiveSessionConnection(peer, sessionId);
  return peer;
}

function rawMessageText(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

export function attachLiveClassSignaling(server: Server): () => void {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  const rooms = new Map<string, Map<string, RoomParticipant>>();
  const pendingPeers = new WeakMap<IncomingMessage, LivePeer>();

  const registerParticipant = (socket: WebSocket, peer: LivePeer) => {
    const roomKey = `${peer.organizationId}:${peer.sessionId}`;
    const room = rooms.get(roomKey) ?? new Map<string, RoomParticipant>();
    if (room.size >= 8) {
      socket.close(1013, 'This demo room is full');
      return;
    }
    const participant = { peer, socket };
    socket.send(JSON.stringify({
      type: 'peers',
      peers: [...room.values()].map(({ peer: current }) => ({ id: current.id, name: current.name, role: current.role })),
    }));
    room.set(peer.id, participant);
    rooms.set(roomKey, room);
    for (const current of room.values()) {
      if (current.peer.id !== peer.id && current.socket.readyState === WebSocket.OPEN) {
        current.socket.send(JSON.stringify({
          type: 'peer-joined',
          peer: { id: peer.id, name: peer.name, role: peer.role },
        }));
      }
    }

    socket.on('message', (raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(rawMessageText(raw)) as unknown;
      } catch {
        socket.close(1008, 'Invalid signaling message');
        return;
      }
      const parsed = signalSchema.safeParse(payload);
      if (!parsed.success) {
        socket.close(1008, 'Invalid signaling message');
        return;
      }
      const message: SignalMessage = parsed.data;
      const target = room.get(message.to);
      if (!target || target.peer.sessionId !== peer.sessionId || target.peer.organizationId !== peer.organizationId) return;
      if (target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({ ...message, from: peer.id }));
      }
    });

    socket.on('close', () => {
      room.delete(peer.id);
      if (room.size === 0) rooms.delete(roomKey);
      else {
        for (const current of room.values()) {
          if (current.socket.readyState === WebSocket.OPEN) {
            current.socket.send(JSON.stringify({ type: 'peer-left', peerId: peer.id }));
          }
        }
      }
    });
  };

  webSocketServer.on('connection', (socket, request) => {
    const peer = pendingPeers.get(request);
    if (!peer) {
      socket.close(1008, 'Authentication required');
      return;
    }
    registerParticipant(socket, peer);
  });

  const handleUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    } catch {
      rejectUpgrade(socket, 400, 'Invalid request URL');
      return;
    }
    if (url.pathname !== '/api/portal/rooms/ws') {
      rejectUpgrade(socket, 404, 'Live session route not found');
      return;
    }
    if (request.headers.origin !== new URL(env.CLIENT_URL).origin) {
      rejectUpgrade(socket, 403, 'The live session origin is not allowed');
      return;
    }
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      rejectUpgrade(socket, 400, 'A session ID is required');
      return;
    }
    void authenticatedPeer(request, sessionId).then((peer) => {
      pendingPeers.set(request, peer);
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocketServer.emit('connection', webSocket, request);
      });
    }).catch((error: unknown) => {
      if (error instanceof HttpError) {
        rejectUpgrade(socket, error.status, error.message);
        return;
      }
      logger.error({ err: error }, 'Unable to authenticate live session connection');
      rejectUpgrade(socket, 500, 'The live session could not be opened');
    });
  };

  server.on('upgrade', handleUpgrade);
  return () => {
    server.off('upgrade', handleUpgrade);
    for (const room of rooms.values()) {
      for (const participant of room.values()) participant.socket.close(1001, 'Server is shutting down');
    }
    rooms.clear();
    webSocketServer.close();
  };
}
