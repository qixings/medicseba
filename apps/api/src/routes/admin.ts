import type { FastifyInstance, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { and, asc, desc, eq, gte, ilike, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { requireAdmin, signAdmin } from '../auth.js';
import { ApiError, badRequest, conflict, notFound } from '../errors.js';
import { env } from '../env.js';
import { refundToken } from '../booking.js';
import { notifyUser } from '../notify.js';
import { broadcastSession } from '../queue.js';
import { applySchedule, generateSettlements, setSessionLimits, settlementPreview } from '../admin-logic.js';
import { addDays, istDate, prettyTime } from '../time.js';

const { adminUsers, auditLog, agentAccounts, chambers, doctors, specialties, schedules, sessions, tokens, payments, users, settlements } = schema;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 17:30');
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const USERNAME = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, '3 to 32 letters, numbers, dot, dash or underscore');
const PASSWORD = z.string().min(8, 'At least 8 characters');

async function audit(req: FastifyRequest, action: string, target?: string, data: Record<string, unknown> = {}) {
  await db.insert(auditLog).values({ adminId: req.admin!.id, action, target, data });
}

const idParam = (req: FastifyRequest) => (req.params as { id: string }).id;

/* ---------- shapes ---------- */

const chamberBody = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['PHARMACY', 'OWN']),
  address: z.string().trim().min(3).max(200),
  area: z.string().trim().min(2).max(60),
  landmark: z.string().trim().max(120).default(''),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  phone: z.string().trim().max(15).default(''),
  openingHours: z.string().trim().regex(/^$|^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, 'Use 09:00-21:00').default(''),
  bookingFee: z.number().int().min(0).max(2000),
  platformFee: z.number().int().min(0).max(500),
  visible: z.boolean().default(true),
});

const doctorBody = z.object({
  name: z.string().trim().min(3).max(80),
  degrees: z.string().trim().min(2).max(120),
  specialtyId: z.string(),
  experienceYears: z.number().int().min(0).max(70),
  consultFee: z.number().int().min(0).max(10000),
  languages: z.array(z.string().trim().min(1)).max(8),
  bio: z.string().trim().max(600).default(''),
  bookingWindowDays: z.number().int().min(1).max(60),
  visible: z.boolean().default(true),
});

const scheduleBody = z.object({
  chamberId: z.string(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: HHMM,
  tokenLimit: z.number().int().min(1).max(500),
  onlineShare: z.number().int().min(0).max(100),
  active: z.boolean().default(true),
});

function sessionOut(s: typeof sessions.$inferSelect) {
  return {
    id: s.id, date: s.date, time: prettyTime(s.startTime), startTime: s.startTime, status: s.status, doctorStatus: s.doctorStatus,
    tokenLimit: s.tokenLimit, onlineLimit: s.onlineLimit, onlineTaken: s.onlineTaken, counterTaken: s.counterTaken, servingNumber: s.servingNumber,
  };
}

/** Photos uploaded from the admin panel, served at /uploads/<file> (outside /v1, like any image on a website). */
export async function uploadRoutes(app: FastifyInstance) {
  app.get('/uploads/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!/^[a-z0-9-]+\.(png|jpe?g|webp)$/i.test(name)) throw notFound('File');
    const file = path.join(env.uploadDir, name);
    if (!existsSync(file)) throw notFound('File');
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return reply.header('cache-control', 'public, max-age=31536000, immutable').type(type).send(createReadStream(file));
  });
}

export async function adminRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024, files: 1 } });

  app.post('/admin/login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const b = z.object({ username: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body);
    const [a] = await db.select().from(adminUsers).where(eq(adminUsers.username, b.username));
    if (!a || !a.active || !(await bcrypt.compare(b.password, a.passwordHash))) throw new ApiError(401, 'bad_login', 'Wrong username or password');
    await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, a.id));
    return { token: signAdmin(a.id, a.role), admin: { id: a.id, username: a.username, name: a.name, role: a.role } };
  });

  /* ================= everyone in the team ================= */
  app.register(async (r) => {
    r.addHook('preHandler', requireAdmin('SUPPORT'));

    r.get('/admin/me', async (req) => {
      const [a] = await db.select().from(adminUsers).where(eq(adminUsers.id, req.admin!.id));
      return { id: a.id, username: a.username, name: a.name, role: a.role };
    });

    r.get('/admin/dashboard', async (req) => {
      const { date } = z.object({ date: DATE.optional() }).parse(req.query);
      const d = date ?? istDate();
      const day = await db.select().from(sessions).innerJoin(doctors, eq(doctors.id, sessions.doctorId)).innerJoin(chambers, eq(chambers.id, sessions.chamberId))
        .where(eq(sessions.date, d)).orderBy(asc(sessions.startTime));
      const money = await settlementPreview(d);
      const sum = (k: 'bookings' | 'bookingFees' | 'platformFees' | 'refunds') => money.reduce((n, x) => n + x[k], 0);
      const [{ patients }] = await db.select({ patients: sql<number>`count(*)::int` }).from(users);
      const [{ newPatients }] = await db.select({ newPatients: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, new Date(`${d}T00:00:00+05:30`)));
      const trend = await db.select({ date: sessions.date, n: sql<number>`count(*)::int` }).from(payments)
        .innerJoin(tokens, eq(tokens.id, payments.tokenId)).innerJoin(sessions, eq(sessions.id, tokens.sessionId))
        .where(and(eq(payments.status, 'PAID'), gte(sessions.date, addDays(d, -13)), lte(sessions.date, d))).groupBy(sessions.date).orderBy(asc(sessions.date));
      return {
        date: d,
        onlineBookings: sum('bookings'),
        walkIns: day.reduce((n, x) => n + x.sessions.counterTaken, 0),
        collected: sum('bookingFees') + sum('platformFees'),
        platformFees: sum('platformFees'),
        owedToChambers: sum('bookingFees'),
        refunds: sum('refunds'),
        patients, newPatients,
        trend: Array.from({ length: 14 }, (_, i) => { const x = addDays(d, i - 13); return { date: x, bookings: trend.find((t) => t.date === x)?.n ?? 0 }; }),
        sittings: day.map((x) => ({ ...sessionOut(x.sessions), doctor: x.doctors.name, chamber: x.chambers.name })),
      };
    });

    r.get('/admin/specialties', async () => db.select().from(specialties).orderBy(asc(specialties.order), asc(specialties.name)));

    r.get('/admin/chambers', async () => {
      const list = await db.select().from(chambers).orderBy(asc(chambers.name));
      const docs = await db.select({ chamberId: schedules.chamberId, n: sql<number>`count(distinct ${schedules.doctorId})::int` }).from(schedules).where(eq(schedules.active, true)).groupBy(schedules.chamberId);
      const logins = await db.select({ chamberId: agentAccounts.chamberId, n: sql<number>`count(*)::int` }).from(agentAccounts).where(eq(agentAccounts.active, true)).groupBy(agentAccounts.chamberId);
      return list.map((c) => ({ ...c, doctors: docs.find((x) => x.chamberId === c.id)?.n ?? 0, logins: logins.find((x) => x.chamberId === c.id)?.n ?? 0 }));
    });

    r.get('/admin/chambers/:id', async (req) => {
      const [c] = await db.select().from(chambers).where(eq(chambers.id, idParam(req)));
      if (!c) throw notFound('Chamber');
      const agents = await db.select({ id: agentAccounts.id, username: agentAccounts.username, active: agentAccounts.active, createdAt: agentAccounts.createdAt })
        .from(agentAccounts).where(eq(agentAccounts.chamberId, c.id)).orderBy(asc(agentAccounts.username));
      const sch = await db.select().from(schedules).innerJoin(doctors, eq(doctors.id, schedules.doctorId)).where(eq(schedules.chamberId, c.id)).orderBy(asc(schedules.startTime));
      return { ...c, agents, schedules: sch.map((x) => ({ ...x.schedules, doctor: { id: x.doctors.id, name: x.doctors.name } })) };
    });

    r.get('/admin/doctors', async (req) => {
      const { q } = z.object({ q: z.string().optional() }).parse(req.query);
      const rows = await db.select().from(doctors).innerJoin(specialties, eq(specialties.id, doctors.specialtyId))
        .where(q ? ilike(doctors.name, `%${q}%`) : undefined).orderBy(asc(doctors.name));
      const sch = await db.select({ doctorId: schedules.doctorId, n: sql<number>`count(*)::int` }).from(schedules).where(eq(schedules.active, true)).groupBy(schedules.doctorId);
      return rows.map((x) => ({ ...x.doctors, specialty: x.specialties.name, schedules: sch.find((s) => s.doctorId === x.doctors.id)?.n ?? 0 }));
    });

    r.get('/admin/doctors/:id', async (req) => {
      const [d] = await db.select().from(doctors).where(eq(doctors.id, idParam(req)));
      if (!d) throw notFound('Doctor');
      const sch = await db.select().from(schedules).innerJoin(chambers, eq(chambers.id, schedules.chamberId)).where(eq(schedules.doctorId, d.id)).orderBy(asc(schedules.startTime));
      return { ...d, schedules: sch.map((x) => ({ ...x.schedules, chamber: { id: x.chambers.id, name: x.chambers.name } })) };
    });

    r.get('/admin/sessions', async (req) => {
      const { date, chamberId } = z.object({ date: DATE.optional(), chamberId: z.string().optional() }).parse(req.query);
      const rows = await db.select().from(sessions).innerJoin(doctors, eq(doctors.id, sessions.doctorId)).innerJoin(chambers, eq(chambers.id, sessions.chamberId))
        .where(and(eq(sessions.date, date ?? istDate()), chamberId ? eq(sessions.chamberId, chamberId) : undefined)).orderBy(asc(sessions.startTime));
      return rows.map((x) => ({ ...sessionOut(x.sessions), doctor: { id: x.doctors.id, name: x.doctors.name }, chamber: { id: x.chambers.id, name: x.chambers.name } }));
    });

    /** Search bookings by phone, name, token id, day or chamber. */
    r.get('/admin/bookings', async (req) => {
      const p = z.object({ q: z.string().trim().optional(), date: DATE.optional(), chamberId: z.string().optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
      const digits = p.q?.replace(/\D/g, '') ?? '';
      const where = and(
        isNotNull(tokens.number),
        p.date ? eq(sessions.date, p.date) : undefined,
        p.chamberId ? eq(sessions.chamberId, p.chamberId) : undefined,
        p.q ? or(
          ilike(tokens.patientName, `%${p.q}%`),
          digits.length >= 4 ? ilike(users.phone, `%${digits}%`) : undefined,
          digits.length >= 4 ? ilike(tokens.phone, `%${digits}%`) : undefined,
          ilike(tokens.id, `${p.q.toLowerCase()}%`),
        ) : undefined,
      );
      const rows = await db.select().from(tokens)
        .innerJoin(sessions, eq(sessions.id, tokens.sessionId))
        .innerJoin(doctors, eq(doctors.id, sessions.doctorId))
        .innerJoin(chambers, eq(chambers.id, sessions.chamberId))
        .leftJoin(users, eq(users.id, tokens.userId))
        .leftJoin(payments, eq(payments.tokenId, tokens.id))
        .where(where).orderBy(desc(sessions.date), asc(tokens.number)).limit(50).offset((p.page - 1) * 50);
      return rows.map((x) => ({
        id: x.tokens.id, number: x.tokens.number, state: x.tokens.state, source: x.tokens.source, patientName: x.tokens.patientName, patientAge: x.tokens.patientAge,
        phone: x.users?.phone ?? x.tokens.phone, date: x.sessions.date, time: prettyTime(x.sessions.startTime), sessionId: x.sessions.id,
        doctor: x.doctors.name, chamber: x.chambers.name, amount: x.payments?.amount ?? null, paymentStatus: x.payments?.status ?? null,
        createdAt: x.tokens.createdAt,
      }));
    });

    r.get('/admin/bookings/:id', async (req) => {
      const [x] = await db.select().from(tokens)
        .innerJoin(sessions, eq(sessions.id, tokens.sessionId)).innerJoin(doctors, eq(doctors.id, sessions.doctorId)).innerJoin(chambers, eq(chambers.id, sessions.chamberId))
        .leftJoin(users, eq(users.id, tokens.userId)).leftJoin(payments, eq(payments.tokenId, tokens.id))
        .where(eq(tokens.id, idParam(req)));
      if (!x) throw notFound('Booking');
      return {
        token: x.tokens, session: sessionOut(x.sessions), doctor: { id: x.doctors.id, name: x.doctors.name }, chamber: { id: x.chambers.id, name: x.chambers.name },
        patient: x.users ? { id: x.users.id, phone: x.users.phone, name: x.users.name } : null, payment: x.payments,
      };
    });

    r.get('/admin/patients', async (req) => {
      const { q } = z.object({ q: z.string().trim().optional() }).parse(req.query);
      const digits = q?.replace(/\D/g, '') ?? '';
      const list = await db.select({
        id: users.id, phone: users.phone, name: users.name, createdAt: users.createdAt,
        bookings: sql<number>`(select count(*)::int from ${tokens} t where t.user_id = ${users.id} and t.number is not null)`,
      }).from(users)
        .where(q ? or(ilike(users.name, `%${q}%`), digits.length >= 4 ? ilike(users.phone, `%${digits}%`) : undefined) : undefined)
        .orderBy(desc(users.createdAt)).limit(100);
      return list;
    });

    r.get('/admin/settlements', async (req) => {
      const { date } = z.object({ date: DATE.optional() }).parse(req.query);
      const d = date ?? addDays(istDate(), -1);
      const saved = await db.select().from(settlements).innerJoin(chambers, eq(chambers.id, settlements.chamberId)).where(eq(settlements.date, d)).orderBy(asc(chambers.name));
      const preview = await settlementPreview(d);
      const pending = await db.select({ chamberId: settlements.chamberId, amount: sql<number>`sum(${settlements.amount})::int`, days: sql<number>`count(*)::int` })
        .from(settlements).where(eq(settlements.status, 'PENDING')).groupBy(settlements.chamberId);
      const names = await db.select({ id: chambers.id, name: chambers.name }).from(chambers);
      return {
        date: d,
        saved: saved.map((x) => ({ ...x.settlements, chamber: x.chambers.name })),
        preview,
        pendingByChamber: pending.map((p) => ({ ...p, chamber: names.find((n) => n.id === p.chamberId)?.name ?? '' })),
      };
    });
  });

  /* ================= managers and owners ================= */
  app.register(async (r) => {
    r.addHook('preHandler', requireAdmin('MANAGER'));

    r.post('/admin/specialties', async (req) => {
      const b = z.object({ name: z.string().trim().min(2).max(40), icon: z.string().default('steth'), order: z.number().int().default(0) }).parse(req.body);
      const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const [row] = await db.insert(specialties).values({ ...b, slug }).onConflictDoNothing().returning();
      if (!row) throw conflict('exists', 'This specialty already exists');
      await audit(req, 'specialty.create', row.id, b);
      return row;
    });

    r.patch('/admin/specialties/:id', async (req) => {
      const b = z.object({ name: z.string().trim().min(2).max(40).optional(), icon: z.string().optional(), order: z.number().int().optional() }).parse(req.body);
      const [row] = await db.update(specialties).set(b).where(eq(specialties.id, idParam(req))).returning();
      if (!row) throw notFound('Specialty');
      await audit(req, 'specialty.update', row.id, b);
      return row;
    });

    r.post('/admin/chambers', async (req) => {
      const b = chamberBody.parse(req.body);
      const [row] = await db.insert(chambers).values(b).returning();
      await audit(req, 'chamber.create', row.id, b);
      return row;
    });

    r.patch('/admin/chambers/:id', async (req) => {
      const b = chamberBody.partial().parse(req.body);
      const [row] = await db.update(chambers).set(b).where(eq(chambers.id, idParam(req))).returning();
      if (!row) throw notFound('Chamber');
      await audit(req, 'chamber.update', row.id, b);
      return row;
    });

    r.post('/admin/chambers/:id/agents', async (req) => {
      const b = z.object({ username: USERNAME, password: PASSWORD }).parse(req.body);
      const [c] = await db.select().from(chambers).where(eq(chambers.id, idParam(req)));
      if (!c) throw notFound('Chamber');
      const [row] = await db.insert(agentAccounts).values({ chamberId: c.id, username: b.username, passwordHash: await bcrypt.hash(b.password, 10) }).onConflictDoNothing().returning();
      if (!row) throw conflict('exists', 'This login name is taken');
      await audit(req, 'agent.create', row.id, { chamberId: c.id, username: b.username });
      return { id: row.id, username: row.username, active: row.active };
    });

    r.patch('/admin/agents/:id', async (req) => {
      const b = z.object({ password: PASSWORD.optional(), active: z.boolean().optional() }).parse(req.body);
      const patch: Partial<typeof agentAccounts.$inferInsert> = {};
      if (b.password) { patch.passwordHash = await bcrypt.hash(b.password, 10); patch.passwordChangedAt = new Date(); }
      if (b.active !== undefined) patch.active = b.active;
      const [row] = await db.update(agentAccounts).set(patch).where(eq(agentAccounts.id, idParam(req))).returning();
      if (!row) throw notFound('Login');
      await audit(req, 'agent.update', row.id, { passwordChanged: !!b.password, active: b.active });
      return { id: row.id, username: row.username, active: row.active };
    });

    r.post('/admin/doctors', async (req) => {
      const b = doctorBody.parse(req.body);
      const [row] = await db.insert(doctors).values(b).returning();
      await audit(req, 'doctor.create', row.id, b);
      return row;
    });

    r.patch('/admin/doctors/:id', async (req) => {
      const b = doctorBody.partial().extend({ photoUrl: z.string().nullable().optional() }).parse(req.body);
      const [row] = await db.update(doctors).set(b).where(eq(doctors.id, idParam(req))).returning();
      if (!row) throw notFound('Doctor');
      await audit(req, 'doctor.update', row.id, b);
      return row;
    });

    /** Upload a doctor photo (PNG with a see-through background looks best, JPG and WebP also work). */
    r.post('/admin/doctors/:id/photo', async (req) => {
      const [d] = await db.select().from(doctors).where(eq(doctors.id, idParam(req)));
      if (!d) throw notFound('Doctor');
      const file = await req.file();
      if (!file) throw badRequest('no_file', 'Choose a photo');
      const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[file.mimetype];
      if (!ext) throw badRequest('bad_type', 'Use a PNG, JPG or WebP photo');
      const buf = await file.toBuffer();
      const sig = buf.subarray(0, 12).toString('hex');
      const real = sig.startsWith('89504e47') ? 'png' : sig.startsWith('ffd8ff') ? 'jpg' : sig.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
      if (real !== ext) throw badRequest('bad_type', 'This file is not a real image');
      await mkdir(env.uploadDir, { recursive: true });
      // Phone-friendly: cut empty see-through edges, at most 1000 px tall, WebP (keeps transparency, much smaller).
      let out: Buffer;
      try {
        out = await sharp(buf).rotate().trim({ threshold: 1 }).resize({ height: 1000, width: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
      } catch {
        throw badRequest('bad_image', 'This photo could not be read. Try another file.');
      }
      const name = `doctor-${randomUUID()}.webp`;
      await writeFile(path.join(env.uploadDir, name), out);
      const [row] = await db.update(doctors).set({ photoUrl: `/uploads/${name}` }).where(eq(doctors.id, d.id)).returning();
      await audit(req, 'doctor.photo', d.id, { file: name });
      return row;
    });

    r.post('/admin/doctors/:id/schedules', async (req) => {
      const b = scheduleBody.parse(req.body);
      const [d] = await db.select().from(doctors).where(eq(doctors.id, idParam(req)));
      if (!d) throw notFound('Doctor');
      const [row] = await db.insert(schedules).values({ ...b, doctorId: d.id }).returning();
      const result = await applySchedule(row.id);
      await audit(req, 'schedule.create', row.id, b);
      return { schedule: row, result };
    });

    r.patch('/admin/schedules/:id', async (req) => {
      const b = scheduleBody.partial().parse(req.body);
      const [row] = await db.update(schedules).set(b).where(eq(schedules.id, idParam(req))).returning();
      if (!row) throw notFound('Schedule');
      const result = await applySchedule(row.id);
      await audit(req, 'schedule.update', row.id, b);
      return { schedule: row, result };
    });

    r.patch('/admin/sessions/:id', async (req) => {
      const b = z.object({ tokenLimit: z.number().int().min(1).max(500).optional(), onlineLimit: z.number().int().min(0).max(500).optional() }).parse(req.body);
      const row = await setSessionLimits(idParam(req), b);
      await broadcastSession(row.id);
      await audit(req, 'session.limits', row.id, b);
      return sessionOut(row);
    });

    /** Full refund by the team, for example when a patient complains. Frees the place if the sitting is still ahead. */
    r.post('/admin/bookings/:id/refund', async (req) => {
      const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
      const [t] = await db.select().from(tokens).where(eq(tokens.id, idParam(req)));
      if (!t) throw notFound('Booking');
      const [pay] = await db.select().from(payments).where(eq(payments.tokenId, t.id));
      if (!pay || pay.status !== 'PAID') throw conflict('not_paid', 'There is no payment to refund for this booking');
      const before = t.state;
      await refundToken(t.id);
      if (['BOOKED', 'ARRIVED', 'HELD'].includes(before)) {
        await db.update(sessions).set({ onlineTaken: sql`greatest(${sessions.onlineTaken} - 1, 0)` }).where(eq(sessions.id, t.sessionId));
        await broadcastSession(t.sessionId);
      }
      if (t.userId) await notifyUser(t.userId, 'refunded', `Refund of ₹${pay.amount} started`, 'It goes back to the UPI account or card you paid from', { tokenId: t.id });
      await audit(req, 'booking.refund', t.id, { reason, amount: pay.amount });
      return { ok: true };
    });

    r.post('/admin/settlements/generate', async (req) => {
      const { date } = z.object({ date: DATE }).parse(req.body);
      const n = await generateSettlements(date);
      await audit(req, 'settlement.generate', date, { chambers: n });
      return { chambers: n };
    });
  });

  /* ================= owners only ================= */
  app.register(async (r) => {
    r.addHook('preHandler', requireAdmin('OWNER'));

    r.post('/admin/settlements/:id/paid', async (req) => {
      const { reference } = z.object({ reference: z.string().trim().min(3).max(80) }).parse(req.body);
      const [row] = await db.update(settlements).set({ status: 'PAID', reference, paidAt: new Date(), paidBy: req.admin!.id })
        .where(and(eq(settlements.id, idParam(req)), eq(settlements.status, 'PENDING'))).returning();
      if (!row) throw conflict('not_pending', 'This settlement is already marked paid');
      await audit(req, 'settlement.paid', row.id, { reference, amount: row.amount });
      return row;
    });

    r.get('/admin/team', async () => db.select({ id: adminUsers.id, username: adminUsers.username, name: adminUsers.name, role: adminUsers.role, active: adminUsers.active, lastLoginAt: adminUsers.lastLoginAt })
      .from(adminUsers).orderBy(asc(adminUsers.name)));

    r.post('/admin/team', async (req) => {
      const b = z.object({ username: USERNAME, name: z.string().trim().min(2).max(60), password: PASSWORD, role: z.enum(['OWNER', 'MANAGER', 'SUPPORT']) }).parse(req.body);
      const [row] = await db.insert(adminUsers).values({ username: b.username, name: b.name, role: b.role, passwordHash: await bcrypt.hash(b.password, 10) }).onConflictDoNothing().returning();
      if (!row) throw conflict('exists', 'This username is taken');
      await audit(req, 'team.create', row.id, { username: b.username, role: b.role });
      return { id: row.id, username: row.username, name: row.name, role: row.role, active: row.active };
    });

    r.patch('/admin/team/:id', async (req) => {
      const b = z.object({ name: z.string().trim().min(2).max(60).optional(), password: PASSWORD.optional(), role: z.enum(['OWNER', 'MANAGER', 'SUPPORT']).optional(), active: z.boolean().optional() }).parse(req.body);
      const id = idParam(req);
      if (id === req.admin!.id && (b.active === false || (b.role && b.role !== 'OWNER'))) throw conflict('self', 'You cannot remove or downgrade yourself');
      const patch: Partial<typeof adminUsers.$inferInsert> = { name: b.name, role: b.role, active: b.active };
      if (b.password) { patch.passwordHash = await bcrypt.hash(b.password, 10); patch.passwordChangedAt = new Date(); }
      const [row] = await db.update(adminUsers).set(patch).where(eq(adminUsers.id, id)).returning();
      if (!row) throw notFound('Team member');
      await audit(req, 'team.update', id, { ...b, password: b.password ? 'changed' : undefined });
      return { id: row.id, username: row.username, name: row.name, role: row.role, active: row.active };
    });

    r.get('/admin/audit', async () => {
      const rows = await db.select().from(auditLog).leftJoin(adminUsers, eq(adminUsers.id, auditLog.adminId)).orderBy(desc(auditLog.createdAt)).limit(200);
      return rows.map((x) => ({ ...x.audit_log, admin: x.admin_users?.name ?? 'Unknown' }));
    });
  });

}
