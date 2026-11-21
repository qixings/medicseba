import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';
import { refreshBoard } from './counter';

let socket: Socket | null = null;

/** Reload the board whenever the queue changes on the server (online bookings, another counter phone). */
export function useLiveBoard(sessionId: string | undefined) {
  useEffect(() => {
    if (!sessionId) return;
    socket ??= io(API_URL, { path: '/socket.io', transports: ['websocket'] });
    const s = socket;
    const onQueue = (p: { sessionId: string }) => { if (p.sessionId === sessionId) void refreshBoard(sessionId); };
    const onConnect = () => { s.emit('watch', sessionId); void refreshBoard(sessionId); };
    s.on('queue', onQueue);
    s.on('connect', onConnect);
    if (s.connected) s.emit('watch', sessionId);
    // Online bookings do not always move the queue, so also check every 20 s.
    const poll = setInterval(() => { void refreshBoard(sessionId); }, 20_000);
    return () => { s.off('queue', onQueue); s.off('connect', onConnect); s.emit('unwatch', sessionId); clearInterval(poll); };
  }, [sessionId]);
}
