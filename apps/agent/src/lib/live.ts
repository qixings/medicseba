import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';
import { refreshBoard } from './counter';

export type Scope = 'catalog' | 'bookings' | 'requests' | 'messages' | 'admin' | 'resume';
type Listener = (scopes: Scope[]) => void;

let socket: Socket | null = null;
const listeners = new Set<Listener>();
const emit = (scopes: Scope[]) => listeners.forEach((l) => l(scopes));

function getSocket() {
  if (socket) return socket;
  socket = io(API_URL, { path: '/socket.io', transports: ['websocket'] });
  let first = true;
  // After a dropped connection, assume we missed something and reload.
  socket.on('connect', () => { if (!first) emit(['resume']); first = false; });
  socket.on('changed', (p: { scopes?: Scope[] }) => emit(p.scopes ?? []));
  // Coming back to the app (phone unlocked, tab shown) also reloads.
  if (Platform.OS === 'web') {
    globalThis.document?.addEventListener('visibilitychange', () => { if (globalThis.document.visibilityState === 'visible') emit(['resume']); });
  } else {
    AppState.addEventListener('change', (st) => { if (st === 'active') emit(['resume']); });
  }
  return socket;
}

/** Run fn when the server says one of these kinds of data changed (or the app wakes up). */
export function useServerChange(scopes: Scope[], fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  const key = scopes.join(',');
  useEffect(() => {
    getSocket();
    const want = new Set<Scope>([...(key.split(',') as Scope[]), 'resume']);
    let t: ReturnType<typeof setTimeout> | null = null;
    const l: Listener = (sc) => {
      if (!sc.some((x) => want.has(x)) || t) return;
      t = setTimeout(() => { t = null; ref.current(); }, 300);
    };
    listeners.add(l);
    return () => { listeners.delete(l); if (t) clearTimeout(t); };
  }, [key]);
}

/** Outside React (the inbox store). */
export function onServerChange(scopes: Scope[], fn: () => void) {
  getSocket();
  const want = new Set<Scope>([...scopes, 'resume']);
  const l: Listener = (sc) => { if (sc.some((x) => want.has(x))) fn(); };
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Reload the board whenever the queue changes on the server (online bookings, another counter phone). */
export function useLiveBoard(sessionId: string | undefined) {
  useServerChange(['bookings', 'catalog'], () => { if (sessionId) void refreshBoard(sessionId); });
  useEffect(() => {
    if (!sessionId) return;
    const s = getSocket();
    const onQueue = (p: { sessionId: string }) => { if (p.sessionId === sessionId) void refreshBoard(sessionId); };
    const onConnect = () => { s.emit('watch', sessionId); void refreshBoard(sessionId); };
    s.on('queue', onQueue);
    s.on('connect', onConnect);
    if (s.connected) s.emit('watch', sessionId);
    // A slow safety net in case an event is missed.
    const poll = setInterval(() => { void refreshBoard(sessionId); }, 60_000);
    return () => { s.off('queue', onQueue); s.off('connect', onConnect); s.emit('unwatch', sessionId); clearInterval(poll); };
  }, [sessionId]);
}
