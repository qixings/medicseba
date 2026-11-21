import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { requireAgent } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { removeUpload, saveUpload } from './admin.js';

const { chambers, doctors, schedules, specialties, changeRequests, auditLog } = schema;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 17:30');

export const doctorFields = z.object({
  name: z.string().trim().min(3).max(80),
  degrees: z.string().trim().min(2).max(120),
  specialtyId: z.string(),
  experienceYears: z.number().int().min(0).max(70),
  consultFee: z.number().int().min(0).max(10000),
  languages: z.array(z.string().trim().min(1)).max(8),
  bio: z.string().trim().max(600).default(''),
});

export const sittingFields = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: HHMM,
  tokenLimit: z.number().int().min(1).max(500),
});

const requestBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new_doctor'), data: z.object({ doctor: doctorFields, sitting: sittingFields }) }),
  z.object({ kind: z.literal('doctor_update'), targetId: z.string(), data: z.object({ doctor: doctorFields.partial(), sitting: sittingFields.partial().extend({ scheduleId: z.string() }).optional(), note: z.string().max(300).optional() }) }),
  z.object({ kind: z.literal('fees'), data: z.object({ bookingFee: z.number().int().min(0).max(2000), note: z.string().max(300).optional() }) }),
]);

/**
 * The chamber's own page in the counter app.
 * Contact details, hours and photos change at once. New doctors, doctor details and fees are sent to the
 * MedicSeba team as requests and go live when approved in the admin panel.
 */
export async function chamberSelfRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', requireAgent);
    const mine = async (chamberId: string) => {
      const [c] = await db.select().from(chambers).where(eq(chambers.id, chamberId));
      if (!c) throw notFound('Chamber');
      return c;
    };

    r.get('/agent/chamber', async (req) => {
      const c = await mine(req.agent!.chamberId);
      const sch = await db.select().from(schedules).innerJoin(doctors, eq(doctors.id, schedules.doctorId)).leftJoin(specialties, eq(specialties.id, doctors.specialtyId))
        .where(and(eq(schedules.chamberId, c.id), eq(schedules.active, true))).orderBy(asc(schedules.startTime));
      const requests = await db.select().from(changeRequests).where(eq(changeRequests.chamberId, c.id)).orderBy(desc(changeRequests.createdAt)).limit(20);
      const specs = await db.select({ id: specialties.id, name: specialties.name }).from(specialties).orderBy(asc(specialties.order));
      return {
        chamber: c,
        doctors: sch.map((x) => ({
          id: x.doctors.id, name: x.doctors.name, photoUrl: x.doctors.photoUrl, degrees: x.doctors.degrees, specialtyId: x.doctors.specialtyId, specialty: x.specialties?.name ?? '',
          experienceYears: x.doctors.experienceYears, consultFee: x.doctors.consultFee, languages: x.doctors.languages, bio: x.doctors.bio,
          sitting: { scheduleId: x.schedules.id, weekdays: x.schedules.weekdays, startTime: x.schedules.startTime, tokenLimit: x.schedules.tokenLimit },
        })),
        requests,
        specialties: specs,
      };
    });

    /** Details that go live at once. */
    r.patch('/agent/chamber', async (req) => {
      const b = z.object({
        phone: z.string().trim().max(15).optional(),
        address: z.string().trim().min(3).max(200).optional(),
        area: z.string().trim().min(2).max(60).optional(),
        landmark: z.string().trim().max(120).optional(),
        openingHours: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, 'Use 09:00-21:00').optional(),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
      }).parse(req.body);
      const [row] = await db.update(chambers).set(b).where(eq(chambers.id, req.agent!.chamberId)).returning();
      await db.insert(auditLog).values({ adminId: `agent:${req.agent!.id}`, action: 'chamber.self_update', target: row.id, data: b });
      return row;
    });

    r.post('/agent/chamber/photos', async (req) => {
      const c = await mine(req.agent!.chamberId);
      if (c.photos.length >= 8) throw conflict('too_many', 'Up to 8 photos. Remove one first.');
      const url = await saveUpload(req, 'chamber', { trim: false, max: 1600 });
      const [row] = await db.update(chambers).set({ photos: [...c.photos, url] }).where(eq(chambers.id, c.id)).returning();
      await db.insert(auditLog).values({ adminId: `agent:${req.agent!.id}`, action: 'chamber.photos', target: c.id, data: { added: url, by: 'counter' } });
      return row;
    });

    r.put('/agent/chamber/photos', async (req) => {
      const { photos } = z.object({ photos: z.array(z.string()).max(8) }).parse(req.body);
      const c = await mine(req.agent!.chamberId);
      if (photos.some((p) => !c.photos.includes(p))) throw badRequest('bad_list', 'Unknown photo in the list');
      const [row] = await db.update(chambers).set({ photos }).where(eq(chambers.id, c.id)).returning();
      for (const p of c.photos.filter((x) => !photos.includes(x))) await removeUpload(p);
      return row;
    });

    /** Ask the team for a change that needs approval. */
    r.post('/agent/requests', async (req) => {
      const b = requestBody.parse(req.body);
      const chamberId = req.agent!.chamberId;
      if (b.kind === 'doctor_update') {
        const [s] = await db.select().from(schedules).where(and(eq(schedules.doctorId, b.targetId), eq(schedules.chamberId, chamberId)));
        if (!s) throw notFound('Doctor');
      }
      const [row] = await db.insert(changeRequests).values({ chamberId, kind: b.kind, targetId: 'targetId' in b ? b.targetId : null, data: b.data as Record<string, unknown> }).returning();
      return row;
    });
  });
}
