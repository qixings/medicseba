import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { renewedToken, requestOtp, requireUser, verifyOtp } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { absentChoice, cancelBooking, confirmPayment, holdToken, reschedule } from '../booking.js';
import { liveView } from '../queue.js';
import { istDate, prettyTime } from '../time.js';

const { users, familyMembers, tokens, sessions, doctors, chambers, payments, notifications } = schema;
const gender = z.enum(['MALE', 'FEMALE', 'OTHER']);
const memberBody = z.object({ name: z.string().trim().min(1).max(60), age: z.number().int().min(0).max(120), gender, relation: z.string().trim().max(30).optional() });

export async function patientRoutes(app: FastifyInstance) {
  // Limits are per phone number, not per IP: many mobile users in India share one carrier IP.
  const byPhone = (req: { body: unknown; ip: string }) => String((req.body as { phone?: string } | null)?.phone ?? req.ip).replace(/\D/g, '').slice(-10);

  app.post('/auth/otp/request', { config: { rateLimit: { max: 5, timeWindow: '10 minutes', keyGenerator: byPhone } } }, async (req) => {
    const { phone } = z.object({ phone: z.string() }).parse(req.body);
    return requestOtp(phone);
  });

  app.post('/auth/otp/verify', { config: { rateLimit: { max: 10, timeWindow: '10 minutes', keyGenerator: byPhone } } }, async (req) => {
    const { phone, code } = z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body);
    const r = await verifyOtp(phone, code);
    return { token: r.token, isNew: r.isNew || !r.user.name, user: { id: r.user.id, phone: r.user.phone, name: r.user.name, language: r.user.language } };
  });

  app.register(async (auth) => {
    auth.addHook('preHandler', requireUser);
    const live = (where: ReturnType<typeof and>) => where;

    auth.get('/me', async (req) => {
      const [u] = await db.select().from(users).where(eq(users.id, req.userId!));
      if (!u) throw notFound('Account');
      const [{ n }] = await db.select({ n: count() }).from(familyMembers).where(and(eq(familyMembers.userId, u.id), isNull(familyMembers.deletedAt)));
      return { id: u.id, phone: u.phone, name: u.name, language: u.language, members: n, token: renewedToken(req) };
    });

    /** First-time profile (name + age + gender creates the "self" family member), or later edits. */
    auth.patch('/me', async (req) => {
      const b = z.object({ name: z.string().trim().min(1).max(60).optional(), language: z.enum(['en', 'bn']).optional(), age: z.number().int().min(0).max(120).optional(), gender: gender.optional() }).parse(req.body);
      const [u] = await db.update(users).set({ ...(b.name ? { name: b.name } : {}), ...(b.language ? { language: b.language } : {}) }).where(eq(users.id, req.userId!)).returning();
      // Renaming later also renames the "myself" family member, so new bookings carry the new name.
      if (b.name && (b.age === undefined || !b.gender)) await db.update(familyMembers).set({ name: b.name }).where(and(eq(familyMembers.userId, u.id), eq(familyMembers.isSelf, true), isNull(familyMembers.deletedAt)));
      if (b.name && b.age !== undefined && b.gender) {
        const [self] = await db.select().from(familyMembers).where(and(eq(familyMembers.userId, u.id), eq(familyMembers.isSelf, true), isNull(familyMembers.deletedAt)));
        if (self) await db.update(familyMembers).set({ name: b.name, age: b.age, gender: b.gender }).where(eq(familyMembers.id, self.id));
        else await db.insert(familyMembers).values({ userId: u.id, name: b.name, age: b.age, gender: b.gender, isSelf: true });
      }
      return { id: u.id, phone: u.phone, name: u.name, language: u.language };
    });

    auth.post('/me/push-token', async (req) => {
      const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
      const [u] = await db.select().from(users).where(eq(users.id, req.userId!));
      if (!u.pushTokens.includes(token)) await db.update(users).set({ pushTokens: [...u.pushTokens.slice(-4), token] }).where(eq(users.id, u.id));
      return { ok: true };
    });

    auth.get('/me/members', async (req) =>
      db.select().from(familyMembers).where(and(eq(familyMembers.userId, req.userId!), isNull(familyMembers.deletedAt))).orderBy(desc(familyMembers.isSelf), asc(familyMembers.createdAt)),
    );
    auth.post('/me/members', async (req) => {
      const b = memberBody.parse(req.body);
      const [{ n }] = await db.select({ n: count() }).from(familyMembers).where(and(eq(familyMembers.userId, req.userId!), isNull(familyMembers.deletedAt)));
      if (n >= 10) throw badRequest('member_limit', 'You can add up to 10 family members');
      const [m] = await db.insert(familyMembers).values({ ...b, userId: req.userId! }).returning();
      return m;
    });
    auth.patch('/me/members/:id', async (req) => {
      const { id } = req.params as { id: string };
      const b = memberBody.partial().parse(req.body);
      const [m] = await db.update(familyMembers).set(b).where(and(eq(familyMembers.id, id), eq(familyMembers.userId, req.userId!), isNull(familyMembers.deletedAt))).returning();
      if (!m) throw notFound('Family member');
      return m;
    });
    auth.delete('/me/members/:id', async (req) => {
      const { id } = req.params as { id: string };
      const [m] = await db.select().from(familyMembers).where(and(eq(familyMembers.id, id), eq(familyMembers.userId, req.userId!), isNull(familyMembers.deletedAt)));
      if (!m) throw notFound('Family member');
      if (m.isSelf) throw badRequest('self', 'You cannot remove yourself');
      await db.update(familyMembers).set({ deletedAt: new Date() }).where(eq(familyMembers.id, id));
      return { ok: true };
    });

    auth.post('/bookings/hold', async (req) => {
      const b = z.object({ sessionId: z.string(), memberId: z.string() }).parse(req.body);
      return holdToken(req.userId!, b.sessionId, b.memberId);
    });

    auth.post('/bookings/confirm', async (req) => {
      const b = z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }).parse(req.body);
      const [p] = await db.select({ userId: tokens.userId }).from(payments).innerJoin(tokens, eq(tokens.id, payments.tokenId)).where(eq(payments.providerOrderId, b.orderId));
      if (!p || p.userId !== req.userId) throw notFound('Order');
      const t = await confirmPayment(b.orderId, b.paymentId, b.signature);
      return liveView(t.id);
    });

    auth.get('/bookings', async (req) => {
      const { scope } = z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming') }).parse(req.query);
      const today = istDate();
      const upcoming = scope === 'upcoming';
      const where = upcoming
        ? and(eq(tokens.userId, req.userId!), inArray(tokens.state, ['BOOKED', 'ARRIVED', 'SERVING']), gte(sessions.date, today))
        : and(eq(tokens.userId, req.userId!), or(inArray(tokens.state, ['DONE', 'MISSED', 'NO_SHOW', 'CANCELLED', 'REFUNDED']), and(inArray(tokens.state, ['BOOKED', 'ARRIVED']), lt(sessions.date, today))));
      const rows = await db.select().from(tokens)
        .innerJoin(sessions, eq(sessions.id, tokens.sessionId))
        .innerJoin(doctors, eq(doctors.id, sessions.doctorId))
        .innerJoin(chambers, eq(chambers.id, sessions.chamberId))
        .leftJoin(payments, eq(payments.tokenId, tokens.id))
        .where(live(where))
        .orderBy(upcoming ? asc(sessions.startsAt) : desc(sessions.startsAt))
        .limit(50);
      return rows.map(({ tokens: t, sessions: s, doctors: d, chambers: c, payments: p }) => ({
        id: t.id, number: t.number, state: t.state, patientName: t.patientName, rescheduleUsed: t.rescheduleUsed, absentChoice: t.absentChoice,
        date: s.date, time: prettyTime(s.startTime), startsAt: s.startsAt, sessionId: s.id, doctorStatus: s.doctorStatus, servingNumber: s.servingNumber,
        doctor: { id: d.id, name: d.name, photoUrl: d.photoUrl },
        chamber: { id: c.id, name: c.name, area: c.area },
        amount: p?.amount ?? null, paymentStatus: p?.status ?? null,
      }));
    });

    auth.get('/bookings/:id/live', async (req) => {
      const { id } = req.params as { id: string };
      const [t] = await db.select({ id: tokens.id }).from(tokens).where(and(eq(tokens.id, id), eq(tokens.userId, req.userId!)));
      if (!t) throw notFound('Booking');
      return liveView(id);
    });

    auth.post('/bookings/:id/cancel', async (req) => cancelBooking(req.userId!, (req.params as { id: string }).id));

    auth.post('/bookings/:id/reschedule', async (req) => {
      const { sessionId } = z.object({ sessionId: z.string() }).parse(req.body);
      const t = await reschedule(req.userId!, (req.params as { id: string }).id, sessionId);
      return liveView(t.id);
    });

    auth.post('/bookings/:id/absent-choice', async (req) => {
      // No refunds: the only choice is a free move to another sitting.
      const b = z.object({ choice: z.literal('move').default('move'), sessionId: z.string() }).parse(req.body);
      const t = await absentChoice(req.userId!, (req.params as { id: string }).id, b.sessionId);
      return liveView(t.id);
    });

    auth.get('/me/notifications', async (req) =>
      db.select().from(notifications).where(eq(notifications.userId, req.userId!)).orderBy(desc(notifications.createdAt)).limit(50),
    );
    auth.post('/me/notifications/read', async (req) => {
      await db.update(notifications).set({ read: true }).where(and(eq(notifications.userId, req.userId!), eq(notifications.read, false)));
      return { ok: true };
    });
  });
}
