export type LiveClassProvider = {
  roomUrl(roomName: string): string;
};

export const jitsiLiveClassProvider: LiveClassProvider = {
  roomUrl(roomName) {
    return `https://meet.jit.si/${encodeURIComponent(roomName)}`;
  },
};
