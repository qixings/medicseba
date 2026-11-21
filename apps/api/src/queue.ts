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

export async function aheadOf(sessionId: string, number: number, servingNumber: number) {
  const [{ n }] = await db.select({ n: count() }).from(tokens)
    .where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, [...WAITING]), gt(tokens.number, servingNumber), lt(tokens.number, number)));
  return n;
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
  const ahead = waiting ? await aheadOf(s.id, t.number!, s.servingNumber) : 0;
  const per = await avgMinutes(s.doctorId);
  return {
    token: { id: t.id, number: t.number, state: t.state, patientName: t.patientName, absentChoice: t.absentChoice, rescheduleUsed: t.rescheduleUsed },
    session: {
      id: s.id, date: s.date, time: prettyTime(s.startTime), startsAt: s.startsAt, status: s.status,
      doctorStatus: s.doctorStatus, lateMinutes: s.lateMinutes, servingNumber: s.servingNumber,
      totalTokens: s.nextNumber - 1, tokenLimit: s.tokenLimit,
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
  const waiting = await db.select().from(tokens)
    .where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, [...WAITING]), isNotNull(tokens.number), gt(tokens.number, s.servingNumber)))
    .orderBy(asc(tokens.number));
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
