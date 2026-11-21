import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { renewedToken, requireAgent, signAgent } from '../auth.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { addWalkIn, callNext, closeBooking, reopenBooking, reopenSitting, setDoctorStatus, tokenAction } from '../booking.js';
import { istDate, prettyTime } from '../time.js';

const { agentAccounts, sessions, doctors, tokens, chambers, specialties, agentMessages } = schema;

function sessionOut(s: typeof sessions.$inferSelect, d: typeof doctors.$inferSelect, spec?: typeof specialties.$inferSelect | null) {
  return {
    id: s.id, date: s.date, time: prettyTime(s.startTime), startTime: s.startTime, startsAt: s.startsAt,
    status: s.status, doctorStatus: s.doctorStatus, lateMinutes: s.lateMinutes,
    tokenLimit: s.tokenLimit, onlineLimit: s.onlineLimit, onlineTaken: s.onlineTaken, counterTaken: s.counterTaken,
    servingNumber: s.servingNumber, nextNumber: s.nextNumber,
    doctor: { id: d.id, name: d.name, photoUrl: d.photoUrl, specialty: spec?.name ?? null },
  };
}

function tokenOut(t: typeof tokens.$inferSelect) {
  return {
    id: t.id, number: t.number, source: t.source, state: t.state, patientName: t.patientName, patientAge: t.patientAge,
    patientGender: t.patientGender, phone: t.source === 'WALKIN' ? t.phone : t.phone ? `${t.phone.slice(0, -10)}xxxxxx${t.phone.slice(-4)}` : null,
    clientRef: t.clientRef, servedAt: t.servedAt, doneAt: t.doneAt, queuePos: t.queuePos, missCount: t.missCount,
    paidAmount: t.paidAmount, paidMethod: t.paidMethod, createdAt: t.createdAt,
  };
}

/** Endpoints for the chamber counter app. One shared login per chamber. */
export async function agentRoutes(app: FastifyInstance) {
  app.post('/agent/login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const b = z.object({ username: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body);
    const [a] = await db.select().from(agentAccounts).where(eq(agentAccounts.username, b.username));
    if (!a || !a.active || !(await bcrypt.compare(b.password, a.passwordHash))) throw new ApiError(401, 'bad_login', 'Wrong username or password');
    const [c] = await db.select().from(chambers).where(eq(chambers.id, a.chamberId));
    return { token: signAgent(a.id, a.chamberId), chamber: { id: c.id, name: c.name, area: c.area } };
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAgent);

    r.get('/agent/me', async (req) => {
      const [c] = await db.select().from(chambers).where(eq(chambers.id, req.agent!.chamberId));
      return { chamber: { id: c.id, name: c.name, area: c.area }, token: renewedToken(req) };
    });

    /** Sittings at this chamber on a day (default today). */
    r.get('/agent/sessions', async (req) => {
      const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
      const rows = await db.select().from(sessions)
        .innerJoin(doctors, eq(doctors.id, sessions.doctorId))
        .leftJoin(specialties, eq(specialties.id, doctors.specialtyId))
        .where(and(eq(sessions.chamberId, req.agent!.chamberId), eq(sessions.date, date ?? istDate()))).orderBy(asc(sessions.startTime));
      return { date: date ?? istDate(), sessions: rows.map((x) => sessionOut(x.sessions, x.doctors, x.specialties)) };
    });

    /** Everything the counter screen shows for one sitting, in one call (also cached for offline use). */
    r.get('/agent/sessions/:id/board', async (req) => {
      const { id } = req.params as { id: string };
      const [x] = await db.select().from(sessions)
        .innerJoin(doctors, eq(doctors.id, sessions.doctorId))
        .leftJoin(specialties, eq(specialties.id, doctors.specialtyId))
        .where(eq(sessions.id, id));
      if (!x) throw notFound('Sitting');
      if (x.sessions.chamberId !== req.agent!.chamberId) throw forbidden();
      const list = await db.select().from(tokens).where(and(eq(tokens.sessionId, id), isNotNull(tokens.number))).orderBy(asc(tokens.queuePos));
      return { session: sessionOut(x.sessions, x.doctors, x.specialties), tokens: list.map(tokenOut), at: new Date().toISOString() };
    });

    r.post('/agent/sessions/:id/walkin', async (req) => {
      const b = z.object({
        name: z.string().trim().min(1).max(80), age: z.number().int().min(0).max(120).optional(),
        gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(), phone: z.string().trim().max(15).optional(), clientRef: z.string().max(64).optional(),
        paidAmount: z.number().int().min(0).max(100000).optional(), paidMethod: z.enum(['CASH', 'UPI']).optional(),
      }).parse(req.body);
      return tokenOut(await addWalkIn(req.agent!.chamberId, (req.params as { id: string }).id, b));
    });

    r.post('/agent/sessions/:id/next', async (req) => {
      const b = z.object({ expect: z.number().int().min(0).optional(), current: z.enum(['DONE', 'MISSED']).optional() }).parse(req.body ?? {});
      const n = await callNext(req.agent!.chamberId, (req.params as { id: string }).id, b);
      return { serving: n ? tokenOut(n) : null };
    });

    r.post('/agent/sessions/:id/status', async (req) => {
      const b = z.object({ status: z.enum(['ON_TIME', 'LATE', 'ARRIVED', 'BREAK', 'NOT_COMING', 'ENDED']), lateMinutes: z.number().int().min(0).max(300).optional() }).parse(req.body);
      return setDoctorStatus(req.agent!.chamberId, (req.params as { id: string }).id, b.status, b.lateMinutes);
    });

    r.post('/agent/sessions/:id/close', async (req) => {
      await closeBooking(req.agent!.chamberId, (req.params as { id: string }).id);
      return { ok: true };
    });

    /** Turn an ended sitting back on. */
    r.post('/agent/sessions/:id/resume', async (req) => reopenSitting(req.agent!.chamberId, (req.params as { id: string }).id));

    r.post('/agent/sessions/:id/reopen', async (req) => {
      await reopenBooking(req.agent!.chamberId, (req.params as { id: string }).id);
      return { ok: true };
    });

    /** Messages from the MedicSeba team to this chamber. */
    r.get('/agent/messages', async (req) =>
      db.select().from(agentMessages).where(eq(agentMessages.chamberId, req.agent!.chamberId)).orderBy(desc(agentMessages.createdAt)).limit(30));

    r.post('/agent/messages/read', async (req) => {
      await db.update(agentMessages).set({ readAt: new Date() }).where(and(eq(agentMessages.chamberId, req.agent!.chamberId), isNull(agentMessages.readAt)));
      return { ok: true };
    });

    r.post('/agent/tokens/:id/:action', async (req) => {
      const { id, action } = z.object({ id: z.string(), action: z.enum(['arrived', 'missed', 'done', 'call', 'restore']) }).parse(req.params);
      return tokenOut(await tokenAction(req.agent!.chamberId, id, action));
    });
  });
}
