import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { apiUrl } from '../lib/api';

type PeerInfo = { id: string; name: string; role: string };
type SignalMessage =
  | { type: 'peers'; peers: PeerInfo[] }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; peerId: string }
  | { type: 'offer'; from: string; description: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; description: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; candidate: RTCIceCandidateInit };

function isPeerInfo(value: unknown): value is PeerInfo {
  if (!value || typeof value !== 'object') return false;
  const peer = value as Record<string, unknown>;
  return typeof peer.id === 'string' && typeof peer.name === 'string' && typeof peer.role === 'string';
}

function parseSignalMessage(value: unknown): SignalMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'peers' && Array.isArray(message.peers) && message.peers.every(isPeerInfo)) {
    return { type: 'peers', peers: message.peers };
  }
  if (message.type === 'peer-joined' && isPeerInfo(message.peer)) {
    return { type: 'peer-joined', peer: message.peer };
  }
  if (message.type === 'peer-left' && typeof message.peerId === 'string') {
    return { type: 'peer-left', peerId: message.peerId };
  }
  if ((message.type === 'offer' || message.type === 'answer') && typeof message.from === 'string' &&
    message.description && typeof message.description === 'object' &&
    'type' in message.description && typeof message.description.type === 'string') {
    return {
      type: message.type,
      from: message.from,
      description: message.description as RTCSessionDescriptionInit,
    };
  }
  if (message.type === 'ice' && typeof message.from === 'string' && message.candidate &&
    typeof message.candidate === 'object' && 'candidate' in message.candidate &&
    typeof message.candidate.candidate === 'string') {
    return { type: 'ice', from: message.from, candidate: message.candidate as RTCIceCandidateInit };
  }
  return null;
}

export function LiveClassRoom({
  sessionId,
  initialStream,
  onLeave,
}: {
  sessionId: string;
  initialStream?: MediaStream;
  onLeave: () => void;
}) {
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const peerInfoRef = useRef(new Map<string, PeerInfo>());
  const candidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const localStreamRef = useRef<MediaStream | null>(initialStream ?? null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(initialStream ?? null);
  const [remotePeers, setRemotePeers] = useState<Array<PeerInfo & { stream: MediaStream }>>([]);
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    const peers = peersRef.current;
    const peerInfo = peerInfoRef.current;
    const candidates = candidatesRef.current;

    const setPeerStream = (peer: PeerInfo, stream: MediaStream) => {
      setRemotePeers((current) => [
        ...current.filter(({ id }) => id !== peer.id),
        { ...peer, stream },
      ]);
    };
    const send = (message: Record<string, unknown>) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const addQueuedCandidates = async (peerId: string, connection: RTCPeerConnection) => {
      const queued = candidates.get(peerId) ?? [];
      candidates.delete(peerId);
      for (const candidate of queued) await connection.addIceCandidate(candidate);
    };
    const createConnection = (peer: PeerInfo) => {
      const existing = peers.get(peer.id);
      if (existing) return existing;
      peerInfo.set(peer.id, peer);
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      const local = localStreamRef.current;
      if (local) {
        for (const track of local.getTracks()) connection.addTrack(track, local);
      }
      connection.onicecandidate = (event) => {
        if (event.candidate) send({ type: 'ice', to: peer.id, candidate: event.candidate.toJSON() });
      };
      connection.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream) setPeerStream(peer, stream);
      };
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'failed') {
          setError('The peer connection could not be established. Check network connectivity and try again.');
        }
      };
      peers.set(peer.id, connection);
      return connection;
    };
    const handleMessage = async (message: SignalMessage) => {
      if (message.type === 'peers') {
        for (const peer of message.peers) {
          const connection = createConnection(peer);
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          send({ type: 'offer', to: peer.id, description: connection.localDescription });
        }
        return;
      }
      if (message.type === 'peer-left') {
        peers.get(message.peerId)?.close();
        peers.delete(message.peerId);
        peerInfo.delete(message.peerId);
        candidates.delete(message.peerId);
        setRemotePeers((current) => current.filter(({ id }) => id !== message.peerId));
        return;
      }
      if (message.type === 'peer-joined') {
        peerInfo.set(message.peer.id, message.peer);
        return;
      }

      const peer = peerInfo.get(message.from);
      const fallbackPeer: PeerInfo = peer ?? { id: message.from, name: 'Participant', role: 'STUDENT' };
      const connection = createConnection(fallbackPeer);
      if (message.type === 'offer') {
        await connection.setRemoteDescription(message.description);
        await addQueuedCandidates(message.from, connection);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        send({ type: 'answer', to: message.from, description: connection.localDescription });
      } else if (message.type === 'answer') {
        await connection.setRemoteDescription(message.description);
        await addQueuedCandidates(message.from, connection);
      } else if (connection.remoteDescription) {
        await connection.addIceCandidate(message.candidate);
      } else {
        candidates.set(message.from, [...(candidates.get(message.from) ?? []), message.candidate]);
      }
    };

    const connect = async () => {
      try {
        const stream = initialStream ?? await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (!active) {
          if (!initialStream) stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        const base = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
        const endpoint = new URL(`${base}/portal/rooms/ws?sessionId=${encodeURIComponent(sessionId)}`, window.location.href);
        endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(endpoint);
        socketRef.current = socket;
        socket.onopen = () => setConnected(true);
        socket.onmessage = (event) => {
          try {
            const message = parseSignalMessage(JSON.parse(String(event.data)) as unknown);
            if (!message) throw new Error('Invalid live session signaling message');
            void handleMessage(message).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Live session connection failed.'));
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Live session message could not be read.');
          }
        };
        socket.onerror = () => setError('The live session signaling connection failed.');
        socket.onclose = (event) => {
          setConnected(false);
          if (active && event.code !== 1000) setError('The live session ended or your access expired.');
        };
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Camera and microphone access could not be started.');
      }
    };
    void connect();

    return () => {
      active = false;
      socket?.close(1000, 'Participant left');
      socketRef.current = null;
      peers.forEach((connection) => connection.close());
      peers.clear();
      peerInfo.clear();
      candidates.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    };
  }, [initialStream, sessionId]);

  useEffect(() => {
    if (localVideo.current && localStream) localVideo.current.srcObject = localStream;
  }, [localStream]);

  const toggleMicrophone = () => {
    const next = !muted;
    localStream?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  };
  const toggleCamera = () => {
    const next = !cameraOff;
    localStream?.getVideoTracks().forEach((track) => { track.enabled = !next; });
    setCameraOff(next);
  };

  return <section className="card live-room-card" aria-label="Live Expert Session">
    <div className="button-row live-room-heading"><div><h2>Live Expert Session</h2><p className="muted">{connected ? 'Connected to the in-platform room.' : 'Connecting to the room…'}</p></div>
      <Button type="button" variant="secondary" onClick={onLeave}>Leave class</Button>
    </div>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    <div className="live-room-grid">
      <article className="live-room-video"><video ref={localVideo} autoPlay muted playsInline /><p>You</p></article>
      {remotePeers.map((peer) => <article className="live-room-video" key={peer.id}>
        <video autoPlay playsInline ref={(element) => { if (element && element.srcObject !== peer.stream) element.srcObject = peer.stream; }} />
        <p>{peer.name}</p>
      </article>)}
      {connected && remotePeers.length === 0 && <p className="muted live-room-waiting">Waiting for another participant to join…</p>}
    </div>
    <div className="button-row live-room-controls">
      <Button type="button" variant="secondary" onClick={toggleMicrophone}>{muted ? 'Unmute microphone' : 'Mute microphone'}</Button>
      <Button type="button" variant="secondary" onClick={toggleCamera}>{cameraOff ? 'Turn camera on' : 'Turn camera off'}</Button>
    </div>
    <p className="muted">This peer-to-peer demo room supports small sessions. Production deployments should configure TURN relays for restrictive networks.</p>
  </section>;
}
