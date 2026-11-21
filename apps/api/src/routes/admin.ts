import type { FastifyInstance, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { and, asc, desc, eq, gte, ilike, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { requireAdmin, signAdmin } from '../auth.js';
import { ApiError, badRequest, conflict, notFound } from '../errors.js';
import { env } from '../env.js';
import { adminMove, refundToken } from '../booking.js';
import { receiptUrl } from '../receipts.js';
import { getNotifySettings, notifyUser, recentMessageLog, resolveAudience, runBroadcast, saveNotifySettings, sendWhatsApp, whatsappConfigured, WHATSAPP_EVENTS, type Audience, type NotifySettings } from '../notify.js';
import { broadcastSession } from '../queue.js';
import { applySchedule, generateSettlements, setSessionLimits, settlementPreview } from '../admin-logic.js';
import { addDays, istDate, prettyTime } from '../time.js';

const { adminUsers, auditLog, agentAccounts, chambers, doctors, specialties, schedules, sessions, tokens, payments, users, settlements, familyMembers, notifications, broadcasts, changeRequests } = schema;

const audienceBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all_patients') }),
  z.object({ kind: z.literal('chamber_patients'), id: z.string() }),
  z.object({ kind: z.literal('doctor_patients'), id: z.string() }),
  z.object({ kind: z.literal('sitting_patients'), id: z.string() }),
  z.object({ kind: z.literal('patient'), id: z.string() }),
  z.object({ kind: z.literal('all_counters') }),
  z.object({ kind: z.literal('counter'), id: z.string() }),
]);

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

/** Read one uploaded image, check it is really an image, shrink it for phones and save it as WebP. Returns its /uploads URL. */
export async function saveUpload(req: FastifyRequest, prefix: string, o: { trim: boolean; max: number }) {
  const file = await req.file();
  if (!file) throw badRequest('no_file', 'Choose a photo');
  const buf = await file.toBuffer();
  const sig = buf.subarray(0, 12).toString('hex');
  const real = sig.startsWith('89504e47') || sig.startsWith('ffd8ff') || (sig.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP');
  if (!real) throw badRequest('bad_type', 'Use a PNG, JPG or WebP photo');
  let out: Buffer;
  try {
    let img = sharp(buf).rotate();
    if (o.trim) img = img.trim({ threshold: 1 });
    out = await img.resize({ width: o.max, height: o.max, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw badRequest('bad_image', 'This photo could not be read. Try another file.');
  }
  await mkdir(env.uploadDir, { recursive: true });
  const name = `${prefix}-${randomUUID()}.webp`;
  await writeFile(path.join(env.uploadDir, name), out);
  return `/uploads/${name}`;
}

/** Delete a photo file we uploaded earlier (bundled sample photos are left alone). */
export async function removeUpload(url: string | null | undefined) {
  if (!url?.startsWith('/uploads/')) return;
  const name = url.slice('/uploads/'.length);
  if (!/^[a-z0-9-]+\.(png|jpe?g|webp)$/i.test(name)) return;
  await unlink(path.join(env.uploadDir, name)).catch(() => {});
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

    r.get('/admin/bookings/:id/receipt', async (req) => ({ url: receiptUrl(idParam(req)) }));

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

    /** Everything about one patient: family, serials, payments and the notifications we sent. */
    r.get('/admin/patients/:id', async (req) => {
      const [u] = await db.select().from(users).where(eq(users.id, idParam(req)));
      if (!u) throw notFound('Patient');
      const family = await db.select().from(familyMembers).where(eq(familyMembers.userId, u.id)).orderBy(desc(familyMembers.isSelf), asc(familyMembers.name));
      const list = await db.select().from(tokens)
        .innerJoin(sessions, eq(sessions.id, tokens.sessionId)).innerJoin(doctors, eq(doctors.id, sessions.doctorId)).innerJoin(chambers, eq(chambers.id, sessions.chamberId))
        .leftJoin(payments, eq(payments.tokenId, tokens.id))
        .where(and(eq(tokens.userId, u.id), isNotNull(tokens.number))).orderBy(desc(sessions.date)).limit(100);
      const notes = await db.select().from(notifications).where(eq(notifications.userId, u.id)).orderBy(desc(notifications.createdAt)).limit(50);
      return {
        id: u.id, phone: u.phone, name: u.name, language: u.language, createdAt: u.createdAt, pushDevices: u.pushTokens.length,
        family: family.map((f) => ({ id: f.id, name: f.name, age: f.age, gender: f.gender, relation: f.relation, isSelf: f.isSelf, removed: !!f.deletedAt })),
        bookings: list.map((x) => ({ id: x.tokens.id, number: x.tokens.number, state: x.tokens.state, patientName: x.tokens.patientName, date: x.sessions.date, time: prettyTime(x.sessions.startTime), doctor: x.doctors.name, chamber: x.chambers.name, amount: x.payments?.status === 'PAID' ? x.payments.amount : null })),
        paid: list.reduce((n, x) => n + (x.payments?.status === 'PAID' ? x.payments.amount : 0), 0),
        notifications: notes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, read: n.read, createdAt: n.createdAt })),
      };
    });

    /** Changes chambers asked for from the counter app. */
    /** Counts for the sidebar badges. */
    r.get('/admin/badges', async () => {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(changeRequests).where(eq(changeRequests.status, 'PENDING'));
      return { requests: n };
    });

    r.get('/admin/requests', async (req) => {
      const { status } = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') }).parse(req.query);
      const rows = await db.select().from(changeRequests).innerJoin(chambers, eq(chambers.id, changeRequests.chamberId))
        .leftJoin(doctors, eq(doctors.id, changeRequests.targetId))
        .where(eq(changeRequests.status, status)).orderBy(desc(changeRequests.createdAt)).limit(100);
      return rows.map((x) => ({ ...x.change_requests, chamber: x.chambers.name, chamberFees: { bookingFee: x.chambers.bookingFee }, current: x.doctors }));
    });

    r.get('/admin/broadcasts', async () => {
      const rows = await db.select().from(broadcasts).leftJoin(adminUsers, eq(adminUsers.id, broadcasts.adminId)).orderBy(desc(broadcasts.createdAt)).limit(50);
      return rows.map((x) => ({ ...x.broadcasts, admin: x.admin_users?.name ?? '' }));
    });

    /** How many people a message would reach, before sending. */
    r.post('/admin/broadcasts/preview', async (req) => {
      const a = audienceBody.parse(req.body);
      const t = await resolveAudience(a as Audience);
      return { patients: t.users.length, counters: t.chambers.length };
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
      const b = doctorBody.partial().parse(req.body);
      const [row] = await db.update(doctors).set(b).where(eq(doctors.id, idParam(req))).returning();
      if (!row) throw notFound('Doctor');
      await audit(req, 'doctor.update', row.id, b);
      return row;
    });

    /** Upload or replace a doctor photo (PNG with a see-through background looks best, JPG and WebP also work). */
    r.post('/admin/doctors/:id/photo', async (req) => {
      const [d] = await db.select().from(doctors).where(eq(doctors.id, idParam(req)));
      if (!d) throw notFound('Doctor');
      const url = await saveUpload(req, 'doctor', { trim: true, max: 1000 });
      const [row] = await db.update(doctors).set({ photoUrl: url }).where(eq(doctors.id, d.id)).returning();
      await removeUpload(d.photoUrl);
      await audit(req, 'doctor.photo', d.id, { file: url, replaced: d.photoUrl });
      return row;
    });

    r.delete('/admin/doctors/:id/photo', async (req) => {
      const [d] = await db.select().from(doctors).where(eq(doctors.id, idParam(req)));
      if (!d) throw notFound('Doctor');
      await db.update(doctors).set({ photoUrl: null }).where(eq(doctors.id, d.id));
      await removeUpload(d.photoUrl);
      await audit(req, 'doctor.photo', d.id, { removed: d.photoUrl });
      return { ok: true };
    });

    /** Add a chamber photo, or replace one (?replace=<its url>). Up to 8 photos; the first is the cover. */
    r.post('/admin/chambers/:id/photos', async (req) => {
      const { replace } = z.object({ replace: z.string().optional() }).parse(req.query);
      const [c] = await db.select().from(chambers).where(eq(chambers.id, idParam(req)));
      if (!c) throw notFound('Chamber');
      if (replace && !c.photos.includes(replace)) throw notFound('Photo');
      if (!replace && c.photos.length >= 8) throw conflict('too_many', 'A chamber can have up to 8 photos. Remove one first.');
      const url = await saveUpload(req, 'chamber', { trim: false, max: 1600 });
      const photos = replace ? c.photos.map((p) => (p === replace ? url : p)) : [...c.photos, url];
      const [row] = await db.update(chambers).set({ photos }).where(eq(chambers.id, c.id)).returning();
      if (replace) await removeUpload(replace);
      await audit(req, 'chamber.photos', c.id, { added: url, replaced: replace });
      return row;
    });

    /** Reorder or delete chamber photos by sending the list to keep, in order. */
    r.put('/admin/chambers/:id/photos', async (req) => {
      const { photos } = z.object({ photos: z.array(z.string()).max(8) }).parse(req.body);
      const [c] = await db.select().from(chambers).where(eq(chambers.id, idParam(req)));
      if (!c) throw notFound('Chamber');
      if (photos.some((p) => !c.photos.includes(p)) || new Set(photos).size !== photos.length) throw badRequest('bad_list', 'Unknown photo in the list');
      const [row] = await db.update(chambers).set({ photos }).where(eq(chambers.id, c.id)).returning();
      const removed = c.photos.filter((p) => !photos.includes(p));
      for (const p of removed) await removeUpload(p);
      await audit(req, 'chamber.photos', c.id, { order: photos.length, removed: removed.length });
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

    r.post('/admin/requests/:id/approve', async (req) => {
      const [cr] = await db.select().from(changeRequests).where(eq(changeRequests.id, idParam(req)));
      if (!cr || cr.status !== 'PENDING') throw conflict('not_pending', 'This request was already decided');
      const d = cr.data as Record<string, any>;
      if (cr.kind === 'new_doctor') {
        const [doc] = await db.insert(doctors).values({ ...d.doctor, bookingWindowDays: 7, visible: true }).returning();
        const [sc] = await db.insert(schedules).values({ doctorId: doc.id, chamberId: cr.chamberId, weekdays: d.sitting.weekdays, startTime: d.sitting.startTime, tokenLimit: d.sitting.tokenLimit, onlineShare: 60 }).returning();
        await applySchedule(sc.id);
      } else if (cr.kind === 'doctor_update' && cr.targetId) {
        if (d.doctor && Object.keys(d.doctor).length) await db.update(doctors).set(d.doctor).where(eq(doctors.id, cr.targetId));
        if (d.sitting?.scheduleId) {
          const { scheduleId, ...rest } = d.sitting;
          await db.update(schedules).set(rest).where(and(eq(schedules.id, scheduleId), eq(schedules.chamberId, cr.chamberId)));
          await applySchedule(scheduleId);
        }
      } else if (cr.kind === 'fees') {
        await db.update(chambers).set({ bookingFee: d.bookingFee }).where(eq(chambers.id, cr.chamberId));
      }
      await db.update(changeRequests).set({ status: 'APPROVED', decidedBy: req.admin!.id, decidedAt: new Date() }).where(eq(changeRequests.id, cr.id));
      await audit(req, 'request.approve', cr.id, { kind: cr.kind });
      return { ok: true };
    });

    r.post('/admin/requests/:id/reject', async (req) => {
      const { note } = z.object({ note: z.string().trim().min(2).max(300) }).parse(req.body);
      const [row] = await db.update(changeRequests).set({ status: 'REJECTED', note, decidedBy: req.admin!.id, decidedAt: new Date() })
        .where(and(eq(changeRequests.id, idParam(req)), eq(changeRequests.status, 'PENDING'))).returning();
      if (!row) throw conflict('not_pending', 'This request was already decided');
      await audit(req, 'request.reject', row.id, { kind: row.kind, note });
      return row;
    });

    /** Send a message to patients or chamber counters. It goes out in the background. */
    r.post('/admin/broadcasts', async (req) => {
      const b = z.object({
        audience: audienceBody, label: z.string().max(120), title: z.string().trim().min(2).max(80), body: z.string().trim().min(2).max(600),
        whatsapp: z.boolean().default(false),
      }).parse(req.body);
      const t = await resolveAudience(b.audience as Audience);
      if (!t.users.length && !t.chambers.length) throw conflict('nobody', 'Nobody matches this audience');
      const counters = b.audience.kind === 'all_counters' || b.audience.kind === 'counter';
      const channels = counters ? ['counter'] : ['app', 'push', ...(b.whatsapp ? ['whatsapp'] : [])];
      const [row] = await db.insert(broadcasts).values({ adminId: req.admin!.id, audience: { ...b.audience, label: b.label }, title: b.title, body: b.body, channels, recipients: t.users.length + t.chambers.length }).returning();
      await audit(req, 'broadcast.send', row.id, { to: b.label, title: b.title, recipients: row.recipients, channels: channels.join(' ') });
      runBroadcast(row.id).catch(async (e) => { req.log.error(e); await db.update(broadcasts).set({ status: 'FAILED' }).where(eq(broadcasts.id, row.id)); });
      return row;
    });

    /** Move a booking to another sitting of the same doctor (the no-refund way to fix a problem). */
    r.post('/admin/bookings/:id/move', async (req) => {
      const { sessionId, reason } = z.object({ sessionId: z.string(), reason: z.string().trim().min(3).max(200) }).parse(req.body);
      const moved = await adminMove(idParam(req), sessionId);
      await audit(req, 'booking.move', idParam(req), { reason, to: sessionId, serial: moved.number });
      return { id: moved.id, number: moved.number };
    });

    /** Upcoming sittings of a doctor, to pick where to move a booking. */
    r.get('/admin/doctors/:id/upcoming', async (req) => {
      const rows = await db.select().from(sessions).innerJoin(chambers, eq(chambers.id, sessions.chamberId))
        .where(and(eq(sessions.doctorId, idParam(req)), gte(sessions.date, istDate()), lte(sessions.date, addDays(istDate(), 30)), eq(sessions.status, 'OPEN')))
        .orderBy(asc(sessions.date), asc(sessions.startTime));
      return rows.map((x) => ({ ...sessionOut(x.sessions), chamber: x.chambers.name, left: Math.max(0, Math.min(x.sessions.onlineLimit - x.sessions.onlineTaken, x.sessions.tokenLimit - x.sessions.onlineTaken - x.sessions.counterTaken)) }));
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

    /**
     * Owner only, and only for payment errors (for example charged twice by the bank).
     * MedicSeba has a no-refund policy; everything else is fixed by moving the serial.
     */
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
      await audit(req, 'booking.refund', t.id, { reason, amount: pay.amount, kind: 'payment error' });
      return { ok: true };
    });

    r.get('/admin/settings/notifications', async () => {
      const [{ withPush }] = await db.select({ withPush: sql<number>`count(*) filter (where cardinality(${users.pushTokens}) > 0)::int` }).from(users);
      return {
        settings: await getNotifySettings(),
        events: WHATSAPP_EVENTS,
        status: {
          whatsapp: whatsappConfigured(),
          sms: env.smsProvider === 'msg91' ? 'msg91' : 'test',
          payments: env.paymentProvider,
          pushDevices: withPush,
        },
        log: await recentMessageLog(20),
      };
    });

    r.put('/admin/settings/notifications', async (req) => {
      const name = z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Template names use small letters, numbers and _');
      const v = z.object({ whatsapp: z.object({ enabled: z.boolean(), template: name, receiptTemplate: name.default('medicseba_receipt'), events: z.record(z.string(), z.boolean()) }) }).parse(req.body);
      await saveNotifySettings(v as NotifySettings);
      await audit(req, 'settings.update', 'notifications', { whatsapp: v.whatsapp.enabled, template: v.whatsapp.template });
      return getNotifySettings();
    });

    r.post('/admin/settings/notifications/test', async (req) => {
      const { phone } = z.object({ phone: z.string() }).parse(req.body);
      const to = phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1');
      if (!/^91[6-9]\d{9}$/.test(to)) throw badRequest('bad_phone', 'Enter a 10-digit Indian mobile number');
      try {
        await sendWhatsApp(to, 'MedicSeba test', 'WhatsApp messages from MedicSeba are working.', { kind: 'test' });
      } catch (e) {
        throw new ApiError(502, 'whatsapp_failed', (e as Error).message);
      }
      return { ok: true };
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
      return rows.map((x) => ({ ...x.audit_log, admin: x.admin_users?.name ?? (x.audit_log.adminId.startsWith('agent:') ? 'Chamber counter' : 'Unknown') }));
    });
  });

}
