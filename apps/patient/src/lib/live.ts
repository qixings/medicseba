import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { focusManager } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';
import { queryClient } from './query';

let socket: Socket | null = null;
let wasConnected = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Mark everything stale; React Query refetches the screens that are open now and the rest when opened. */
function refetchAll() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; void queryClient.invalidateQueries(); }, 400);
}

/** Connect once at app start, and refetch when the app comes back to the foreground. */
export function startLive() {
  getSocket();
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (st) => focusManager.setFocused(st === 'active'));
  }
}
const watching = new Map<string, number>();

function getSocket() {
  if (!socket) {
    socket = io(API_URL, { path: '/socket.io', transports: ['websocket'] });
    socket.on('connect', () => { watching.forEach((_, id) => socket!.emit('watch', id)); if (wasConnected) refetchAll(); wasConnected = true; });
    // Something changed on the server (admin edit, counter action, chamber update): refetch what is on screen.
    socket.on('changed', (p: { scopes?: string[] }) => {
      if (p.scopes?.some((x) => x === 'catalog' || x === 'bookings' || x === 'messages')) refetchAll();
    });
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
