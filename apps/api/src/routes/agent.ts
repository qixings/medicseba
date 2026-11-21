import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { requireAgent, signAgent } from '../auth.js';
import { ApiError, forbidden } from '../errors.js';
import { addWalkIn, callNext, closeBooking, setDoctorStatus } from '../booking.js';
import { istDate, prettyTime } from '../time.js';

const { agentAccounts, sessions, doctors, tokens } = schema;

/** Minimal chamber-side endpoints. The full agent app builds on these. */
export async function agentRoutes(app: FastifyInstance) {
  app.post('/agent/login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const b = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    const [a] = await db.select().from(agentAccounts).where(eq(agentAccounts.username, b.username));
    if (!a || !a.active || !(await bcrypt.compare(b.password, a.passwordHash))) throw new ApiError(401, 'bad_login', 'Wrong username or password');
    return { token: signAgent(a.id, a.chamberId), chamberId: a.chamberId };
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAgent);

    r.get('/agent/sessions', async (req) => {
      const { date } = z.object({ date: z.string().optional() }).parse(req.query);
      const rows = await db.select().from(sessions).innerJoin(doctors, eq(doctors.id, sessions.doctorId))
        .where(and(eq(sessions.chamberId, req.agent!.chamberId), eq(sessions.date, date ?? istDate()))).orderBy(asc(sessions.startTime));
      return rows.map((x) => ({ ...x.sessions, time: prettyTime(x.sessions.startTime), doctor: { id: x.doctors.id, name: x.doctors.name } }));
    });

    r.get('/agent/sessions/:id/tokens', async (req) => {
      const { id } = req.params as { id: string };
      const [s] = await db.select().from(sessions).where(eq(sessions.id, id));
      if (!s || s.chamberId !== req.agent!.chamberId) throw forbidden();
      return db.select().from(tokens).where(and(eq(tokens.sessionId, id), isNotNull(tokens.number))).orderBy(asc(tokens.number));
    });

    r.post('/agent/sessions/:id/walkin', async (req) => {
      const b = z.object({ name: z.string().trim().min(1), age: z.number().int().optional(), gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(), phone: z.string().optional() }).parse(req.body);
      return addWalkIn(req.agent!.chamberId, (req.params as { id: string }).id, b);
    });

    r.post('/agent/sessions/:id/next', async (req) => callNext(req.agent!.chamberId, (req.params as { id: string }).id));

    r.post('/agent/sessions/:id/status', async (req) => {
      const b = z.object({ status: z.enum(['ON_TIME', 'LATE', 'ARRIVED', 'BREAK', 'NOT_COMING', 'ENDED']), lateMinutes: z.number().int().min(0).max(300).optional() }).parse(req.body);
      return setDoctorStatus(req.agent!.chamberId, (req.params as { id: string }).id, b.status, b.lateMinutes);
    });

    r.post('/agent/sessions/:id/close', async (req) => {
      await closeBooking(req.agent!.chamberId, (req.params as { id: string }).id);
      return { ok: true };
    });
  });
}
