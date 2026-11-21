import type { Server } from 'socket.io';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema } from './db.js';
import { env } from './env.js';
import { notifyUser } from './notify.js';
import { prettyTime } from './time.js';

const { tokens, sessions, doctors, chambers, notifications } = schema;
let io: Server | null = null;

export function attachIo(server: Server) {
  io = server;
  server.on('connection', (socket) => {
    socket.on('watch', (sessionId: unknown) => {
      if (typeof sessionId === 'string' && sessionId.length < 64) socket.join(`session:${sessionId}`);
    });
    socket.on('unwatch', (sessionId: unknown) => {
      if (typeof sessionId === 'string') socket.leave(`session:${sessionId}`);
    });
  });
}

/** What kind of data changed, so open screens know whether to reload. Carries no data itself. */
export type ChangeScope = 'catalog' | 'bookings' | 'requests' | 'messages' | 'admin';

const pending = new Set<ChangeScope>();
let flushTimer: NodeJS.Timeout | null = null;
/** Tell every open app that something changed (batched over 300 ms so a burst sends one event). */
export function broadcastChange(...scopes: ChangeScope[]) {
  scopes.forEach((x) => pending.add(x));
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const list = [...pending]; pending.clear();
    io?.emit('changed', { scopes: list });
  }, 300);
}

/** Which scopes a successful write to this path touches. */
export function scopesFor(method: string, url: string): ChangeScope[] {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return [];
  const path = url.split('?')[0].replace(/^\/v1/, '');
  if (path.startsWith('/auth')) return [];
  if (path.endsWith('/receipt') || path.endsWith('/receipt/whatsapp') || path.endsWith('/preview') || path.endsWith('/test') || path === '/me/push-token') return [];
  if (path.startsWith('/agent/requests')) return ['requests'];
  if (path.startsWith('/admin/requests')) return ['requests', 'catalog'];
  if (path.startsWith('/agent/messages') || path.startsWith('/admin/broadcasts')) return ['messages'];
  if (path.startsWith('/agent/chamber')) return ['catalog'];
  if (path.startsWith('/agent/sessions') || path.startsWith('/agent/tokens') || path.startsWith('/admin/sessions')) return ['bookings', 'catalog'];
  if (/^\/admin\/(chambers|doctors|schedules|specialties|agents)/.test(path)) return ['catalog'];
  if (path.startsWith('/admin/bookings')) return ['bookings'];
  if (path.startsWith('/admin')) return ['admin'];
  if (path.startsWith('/bookings') || path.startsWith('/pay') || path.startsWith('/webhooks') || path.startsWith('/holds')) return ['bookings'];
  return [];
}

const WAITING = ['BOOKED', 'ARRIVED'] as const;

/** Minutes per patient for this doctor, from recently finished tokens; falls back to the default. */
export async function avgMinutes(doctorId: string): Promise<number> {
  const done = await db.select({ servedAt: tokens.servedAt, doneAt: tokens.doneAt }).from(tokens)
    .innerJoin(sessions, eq(sessions.id, tokens.sessionId))
    .where(and(eq(sessions.doctorId, doctorId), eq(tokens.state, 'DONE'), isNotNull(tokens.servedAt), isNotNull(tokens.doneAt)))
    .orderBy(desc(tokens.doneAt)).limit(40);
  const mins = done.map((d) => (d.doneAt!.getTime() - d.servedAt!.getTime()) / 60_000).filter((m) => m > 0.5 && m < 60);
  if (mins.length < 5) return env.avgMinutesPerPatient;
  return Math.max(2, Math.round(mins.reduce((a, b) => a + b, 0) / mins.length));
}

/** Patients still waiting who come before this place in the line. */
export async function aheadOf(sessionId: string, queuePos: number) {
  const [{ n }] = await db.select({ n: count() }).from(tokens)
    .where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, [...WAITING]), isNotNull(tokens.number), lt(tokens.queuePos, queuePos)));
  return n;
}

/** Where the queue stands: how many were seen (including the one with the doctor) out of all serials given. */
export async function queueProgress(sessionId: string) {
  const [r] = await db.select({
    seen: sql<number>`count(*) filter (where ${tokens.state} in ('DONE', 'SERVING'))::int`,
    total: sql<number>`count(*) filter (where ${tokens.state} in ('BOOKED', 'ARRIVED', 'SERVING', 'DONE', 'MISSED', 'NO_SHOW'))::int`,
  }).from(tokens).where(and(eq(tokens.sessionId, sessionId), isNotNull(tokens.number)));
  return r;
}

/** Everything the live queue screen needs for one token. */
export async function liveView(tokenId: string) {
  const [r] = await db.select().from(tokens)
    .innerJoin(sessions, eq(sessions.id, tokens.sessionId))
    .innerJoin(doctors, eq(doctors.id, sessions.doctorId))
    .innerJoin(chambers, eq(chambers.id, sessions.chamberId))
    .where(eq(tokens.id, tokenId));
  if (!r) return null;
  const { tokens: t, sessions: s, doctors: d, chambers: c } = r;
  const waiting = t.number !== null && (t.state === 'BOOKED' || t.state === 'ARRIVED');
  const ahead = waiting ? await aheadOf(s.id, t.queuePos ?? t.number!) : 0;
  const progress = await queueProgress(s.id);
  const per = await avgMinutes(s.doctorId);
  return {
    token: { id: t.id, number: t.number, state: t.state, patientName: t.patientName, absentChoice: t.absentChoice, rescheduleUsed: t.rescheduleUsed, missCount: t.missCount, source: t.source },
    session: {
      id: s.id, date: s.date, time: prettyTime(s.startTime), startsAt: s.startsAt, status: s.status,
      doctorStatus: s.doctorStatus, lateMinutes: s.lateMinutes, servingNumber: s.servingNumber,
      totalTokens: progress.total, seen: progress.seen, tokenLimit: s.tokenLimit,
    },
    doctor: { id: d.id, name: d.name, photoUrl: d.photoUrl },
    chamber: { id: c.id, name: c.name, area: c.area, address: c.address, lat: c.lat, lng: c.lng },
    ahead,
    minutesPerPatient: per,
    waitMinutes: ahead * per + (s.doctorStatus === 'LATE' ? s.lateMinutes : 0),
  };
}

export async function broadcastSession(sessionId: string) {
  if (!io) return;
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!s) return;
  io.to(`session:${sessionId}`).emit('queue', { sessionId, servingNumber: s.servingNumber, doctorStatus: s.doctorStatus, lateMinutes: s.lateMinutes, status: s.status });
}

/** Send "5 ahead" and "2 ahead" alerts once per token. */
export async function checkAheadAlerts(sessionId: string) {
  const [r] = await db.select().from(sessions).innerJoin(chambers, eq(chambers.id, sessions.chamberId)).where(eq(sessions.id, sessionId));
  if (!r) return;
  const s = r.sessions;
  if (s.status === 'ENDED' || s.status === 'CANCELLED') return;
  const waiting = await db.select().from(tokens)
    .where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, [...WAITING]), isNotNull(tokens.number)))
    .orderBy(asc(tokens.queuePos));
  for (let i = 0; i < waiting.length; i++) {
    const t = waiting[i];
    if (t.source !== 'ONLINE' || !t.userId) continue;
    const ahead = i; // tokens before this one in the waiting list
    const kind = ahead === 5 ? 'ahead5' : ahead === 2 ? 'ahead2' : null;
    if (!kind) continue;
    const [sent] = await db.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, t.userId), eq(notifications.kind, kind), sql`${notifications.data}->>'tokenId' = ${t.id}`)).limit(1);
    if (sent) continue;
    await notifyUser(t.userId, kind, `${ahead} patients ahead of you`, `Serial ${t.number} at ${r.chambers.name}. Start heading there.`, { tokenId: t.id });
  }
}
