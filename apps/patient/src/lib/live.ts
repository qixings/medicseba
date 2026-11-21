import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';
import { queryClient } from './query';

let socket: Socket | null = null;
const watching = new Map<string, number>();

function getSocket() {
  if (!socket) {
    socket = io(API_URL, { path: '/socket.io', transports: ['websocket'] });
    socket.on('connect', () => watching.forEach((_, id) => socket!.emit('watch', id)));
    // Any queue change: refetch the live views and bookings that depend on it.
    socket.on('queue', () => {
      void queryClient.invalidateQueries({ predicate: (q) => {
        const k = q.queryKey[0];
        return typeof k === 'string' && (k.includes('/live') || k.startsWith('/home') || k.startsWith('/bookings'));
      } });
    });
  }
  return socket;
}

/** Keep the live queue of a sitting up to date while the screen is open. */
export function useWatchSession(sessionId: string | undefined | null) {
  useEffect(() => {
    if (!sessionId) return;
    const s = getSocket();
    watching.set(sessionId, (watching.get(sessionId) ?? 0) + 1);
    s.emit('watch', sessionId);
    return () => {
      const n = (watching.get(sessionId) ?? 1) - 1;
      if (n <= 0) { watching.delete(sessionId); s.emit('unwatch', sessionId); } else watching.set(sessionId, n);
    };
  }, [sessionId]);
}
