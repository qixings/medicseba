import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, gte, ilike, inArray, isNull, lt, ne, or, like, count } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { notFound } from '../errors.js';
import { ensureSessions, sessionView } from '../sessions.js';
import { addDays, istDate, prettyTime } from '../time.js';
import { chamberView, doctorView } from '../views.js';
import { liveView } from '../queue.js';
import { readClaims } from '../auth.js';

const { specialties, doctors, chambers, sessions, schedules, tokens } = schema;

const initials = (name: string) =>
  name.replace(/^Dr\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export async function catalogRoutes(app: FastifyInstance) {
  app.get('/specialties', async () => {
    const rows = await db.select({ s: specialties, n: count(doctors.id) }).from(specialties)
      .leftJoin(doctors, and(eq(doctors.specialtyId, specialties.id), eq(doctors.visible, true)))
      .groupBy(specialties.id).orderBy(asc(specialties.order));
    return rows.map((r) => ({ slug: r.s.slug, name: r.s.name, icon: r.s.icon, doctors: r.n }));
  });

  app.get('/home', async (req) => {
    const claims = readClaims(req.headers.authorization);
    const userId = claims?.role === 'patient' ? claims.sub : null;
    const date = istDate();
    await ensureSessions(date, 1);
    const today = await db.select().from(sessions)
      .innerJoin(doctors, eq(doctors.id, sessions.doctorId))
      .innerJoin(specialties, eq(specialties.id, doctors.specialtyId))
      .innerJoin(chambers, eq(chambers.id, sessions.chamberId))
      .where(and(eq(sessions.date, date), eq(doctors.visible, true), eq(chambers.visible, true), ne(sessions.status, 'CANCELLED')))
      .orderBy(asc(sessions.startTime));
    const specs = await db.select().from(specialties).orderBy(asc(specialties.order));
    const chamberRows = await db.select().from(chambers).where(eq(chambers.visible, true)).orderBy(asc(chambers.name));

    let activeToken = null;
    if (userId) {
      const [t] = await db.select({ id: tokens.id }).from(tokens).innerJoin(sessions, eq(sessions.id, tokens.sessionId))
        .where(and(eq(tokens.userId, userId), inArray(tokens.state, ['BOOKED', 'ARRIVED', 'SERVING']), gte(sessions.date, date)))
        .orderBy(asc(sessions.startsAt)).limit(1);
      if (t) activeToken = await liveView(t.id);
    }
    return {
      date,
      sittingToday: new Set(today.map((r) => r.doctors.id)).size,
      activeToken,
      specialties: specs.map((s) => ({ slug: s.slug, name: s.name, icon: s.icon })),
      chambers: chamberRows.map((c) => {
        const here = today.filter((r) => r.chambers.id === c.id);
        return { ...chamberView(c), doctorsToday: here.length, doctorInitials: here.slice(0, 3).map((r) => initials(r.doctors.name)) };
      }),
      sessionsToday: today.map((r) => ({ ...sessionView(r.sessions, r.chambers, r.doctors.bookingWindowDays), doctor: doctorView(r.doctors, r.specialties) })),
    };
  });

  app.get('/doctors', async (req) => {
    const q = z.object({ specialty: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), available: z.string().optional(), q: z.string().max(60).optional() }).parse(req.query);
    const date = q.date ?? istDate();
    await ensureSessions(date, 1);
    const conds = [eq(doctors.visible, true)];
    if (q.specialty) conds.push(eq(specialties.slug, q.specialty));
    if (q.q) conds.push(or(ilike(doctors.name, `%${q.q}%`), ilike(specialties.name, `%${q.q}%`))!);
    const docs = await db.select().from(doctors).innerJoin(specialties, eq(specialties.id, doctors.specialtyId)).where(and(...conds)).orderBy(asc(doctors.name));
    const ids = docs.map((d) => d.doctors.id);
    const sess = ids.length
      ? await db.select().from(sessions).innerJoin(chambers, eq(chambers.id, sessions.chamberId))
          .where(and(inArray(sessions.doctorId, ids), eq(sessions.date, date), ne(sessions.status, 'CANCELLED'))).orderBy(asc(sessions.startTime))
      : [];
    const list = docs.map((d) => ({
      ...doctorView(d.doctors, d.specialties),
      sessions: sess.filter((s) => s.sessions.doctorId === d.doctors.id).map((s) => sessionView(s.sessions, s.chambers, d.doctors.bookingWindowDays)),
    }));
    const spec = q.specialty ? (await db.select().from(specialties).where(eq(specialties.slug, q.specialty)))[0] : null;
    return { date, specialty: spec ? { slug: spec.slug, name: spec.name } : null, doctors: q.available === '1' ? list.filter((d) => d.sessions.some((s) => s.bookable)) : list };
  });

  app.get('/doctors/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [d] = await db.select().from(doctors).innerJoin(specialties, eq(specialties.id, doctors.specialtyId)).where(and(eq(doctors.id, id), eq(doctors.visible, true)));
    if (!d) throw notFound('Doctor');
    const from = istDate();
    await ensureSessions(from, Math.max(d.doctors.bookingWindowDays, 7));
    const sched = await db.select().from(schedules).innerJoin(chambers, eq(chambers.id, schedules.chamberId)).where(and(eq(schedules.doctorId, id), eq(schedules.active, true)));
    const week = await db.select().from(sessions).innerJoin(chambers, eq(chambers.id, sessions.chamberId))
      .where(and(eq(sessions.doctorId, id), gte(sessions.date, from), lt(sessions.date, addDays(from, 7))))
      .orderBy(asc(sessions.date), asc(sessions.startTime));
    return {
      ...doctorView(d.doctors, d.specialties),
      chambers: sched.map((s) => ({ ...chamberView(s.chambers), weekdays: s.schedules.weekdays, time: prettyTime(s.schedules.startTime) })),
      week: week.map((s) => sessionView(s.sessions, s.chambers, d.doctors.bookingWindowDays)),
    };
  });

  app.get('/doctors/:id/calendar', async (req) => {
    const { id } = req.params as { id: string };
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    const [d] = await db.select().from(doctors).where(and(eq(doctors.id, id), eq(doctors.visible, true)));
    if (!d) throw notFound('Doctor');
    await ensureSessions(istDate(), Math.max(d.bookingWindowDays, 31));
    const rows = await db.select().from(sessions).innerJoin(chambers, eq(chambers.id, sessions.chamberId))
      .where(and(eq(sessions.doctorId, id), like(sessions.date, `${month}-%`)))
      .orderBy(asc(sessions.date), asc(sessions.startTime));
    return { month, today: istDate(), sessions: rows.map((s) => sessionView(s.sessions, s.chambers, d.bookingWindowDays)) };
  });

  app.get('/chambers', async (req) => {
    const q = z.object({ q: z.string().max(60).optional(), filter: z.enum(['all', 'open', 'pharmacy', 'own']).optional() }).parse(req.query);
    const date = istDate();
    await ensureSessions(date, 1);
    const conds = [eq(chambers.visible, true)];
    if (q.q) conds.push(or(ilike(chambers.name, `%${q.q}%`), ilike(chambers.area, `%${q.q}%`))!);
    if (q.filter === 'pharmacy') conds.push(eq(chambers.kind, 'PHARMACY'));
    if (q.filter === 'own') conds.push(eq(chambers.kind, 'OWN'));
    const rows = await db.select({ c: chambers, n: count(sessions.id) }).from(chambers)
      .leftJoin(sessions, and(eq(sessions.chamberId, chambers.id), eq(sessions.date, date), ne(sessions.status, 'CANCELLED')))
      .where(and(...conds)).groupBy(chambers.id).orderBy(asc(chambers.name));
    const list = rows.map((r) => ({ ...chamberView(r.c), doctorsToday: r.n }));
    return q.filter === 'open' ? list.filter((c) => c.openNow) : list;
  });

  app.get('/chambers/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [c] = await db.select().from(chambers).where(and(eq(chambers.id, id), eq(chambers.visible, true)));
    if (!c) throw notFound('Chamber');
    const docs = await db.select().from(schedules)
      .innerJoin(doctors, eq(doctors.id, schedules.doctorId))
      .innerJoin(specialties, eq(specialties.id, doctors.specialtyId))
      .where(and(eq(schedules.chamberId, id), eq(schedules.active, true), eq(doctors.visible, true)));
    const today = await db.select().from(sessions).innerJoin(doctors, eq(doctors.id, sessions.doctorId))
      .where(and(eq(sessions.chamberId, id), eq(sessions.date, istDate())));
    return {
      ...chamberView(c),
      doctors: docs.map((r) => ({ ...doctorView(r.doctors, r.specialties), weekdays: r.schedules.weekdays, time: prettyTime(r.schedules.startTime) })),
      today: today.map((r) => ({ ...sessionView(r.sessions, c, r.doctors.bookingWindowDays), doctorId: r.doctors.id })),
    };
  });
}

void isNull;
