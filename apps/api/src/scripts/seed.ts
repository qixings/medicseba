// Sample data for development and demos. Replace with real doctors and chambers in admin.
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { db, pool, schema } from '../db.js';

const { specialties, chambers, doctors, schedules, agentAccounts } = schema;
const MON_SAT = [1, 2, 3, 4, 5, 6]; // 0 Sun ... 6 Sat

const specs: [string, string, string][] = [
  ['general', 'General physician', 'steth'], ['child', 'Child', 'baby'], ['women', 'Women', 'heart'], ['skin', 'Skin', 'drop'],
  ['ent', 'ENT', 'ear'], ['eye', 'Eye', 'eye'], ['bones', 'Bones', 'bone'], ['teeth', 'Teeth', 'tooth'],
];

const chamberData = [
  { key: 'city', name: 'City Medicos', kind: 'PHARMACY' as const, address: 'Station Road, Kailashahar', area: 'Station Road', landmark: 'Opposite the bus stand', lat: 24.3318, lng: 92.0062, openingHours: '08:00-21:30' },
  { key: 'lifeline', name: 'Lifeline Pharmacy', kind: 'PHARMACY' as const, address: 'Kalibari Road, Kailashahar', area: 'Kalibari', landmark: 'Near Kali Bari', lat: 24.3289, lng: 92.0101, openingHours: '08:30-21:00' },
  { key: 'sen', name: 'Sen Clinic', kind: 'OWN' as const, address: 'Hospital Road, Kailashahar', area: 'Hospital Road', landmark: 'Near the district hospital', lat: 24.3351, lng: 92.0034, openingHours: '16:00-20:00' },
  { key: 'roy', name: 'Dr. Roy Skin Care', kind: 'OWN' as const, address: 'Gourangatilla, Kailashahar', area: 'Gourangatilla', landmark: '', lat: 24.3262, lng: 92.0003, openingHours: '19:00-21:30' },
];

type Sched = [string, number[], string, number];
const doctorData: { name: string; degrees: string; spec: string; exp: number; fee: number; langs: string[]; bio: string; sched: Sched[] }[] = [
  { name: 'Dr. Amit Nath', degrees: 'MBBS, MD (Medicine)', spec: 'general', exp: 12, fee: 300, langs: ['Bengali', 'English', 'Hindi'], bio: 'Treats fever, diabetes, blood pressure and everyday illness for adults and older patients.', sched: [['city', [1, 3, 5], '17:00', 40], ['lifeline', [2, 6], '10:00', 40]] },
  { name: 'Dr. Riya Chakraborty', degrees: 'MBBS, MD (Medicine)', spec: 'general', exp: 9, fee: 300, langs: ['Bengali', 'English'], bio: 'General medicine for adults.', sched: [['city', MON_SAT, '18:00', 40]] },
  { name: 'Dr. Priya Debnath', degrees: 'MBBS, MD (Paediatrics)', spec: 'child', exp: 8, fee: 350, langs: ['Bengali', 'English', 'Hindi'], bio: 'Child specialist: newborn care, fever, growth and vaccination advice.', sched: [['lifeline', MON_SAT, '16:30', 30]] },
  { name: 'Dr. Mitali Saha', degrees: 'MBBS, MS (Obstetrics and Gynaecology)', spec: 'women', exp: 11, fee: 400, langs: ['Bengali', 'English'], bio: 'Pregnancy care and women\'s health.', sched: [['city', [1, 2, 4, 6], '11:00', 30]] },
  { name: 'Dr. Sujit Roy', degrees: 'MBBS, MD (Dermatology)', spec: 'skin', exp: 7, fee: 400, langs: ['Bengali', 'English'], bio: 'Skin, hair and allergy problems.', sched: [['roy', MON_SAT, '19:00', 25]] },
  { name: 'Dr. Kamal Sinha', degrees: 'MBBS', spec: 'general', exp: 15, fee: 250, langs: ['Bengali', 'Hindi'], bio: 'Family doctor.', sched: [['sen', MON_SAT, '16:00', 40]] },
];

export async function seed() {
  const sp: Record<string, string> = {};
  for (const [i, [slug, name, icon]] of specs.entries()) {
    const [row] = await db.insert(specialties).values({ slug, name, icon, order: i })
      .onConflictDoUpdate({ target: specialties.slug, set: { name, icon, order: i } }).returning();
    sp[slug] = row.id;
  }
  const ch: Record<string, string> = {};
  for (const { key, ...data } of chamberData) {
    const [found] = await db.select().from(chambers).where(eq(chambers.name, data.name));
    const [row] = found ? await db.update(chambers).set(data).where(eq(chambers.id, found.id)).returning() : await db.insert(chambers).values(data).returning();
    ch[key] = row.id;
  }
  for (const d of doctorData) {
    const data = { name: d.name, degrees: d.degrees, specialtyId: sp[d.spec], experienceYears: d.exp, consultFee: d.fee, languages: d.langs, bio: d.bio };
    const [found] = await db.select().from(doctors).where(eq(doctors.name, d.name));
    const [doc] = found ? await db.update(doctors).set(data).where(eq(doctors.id, found.id)).returning() : await db.insert(doctors).values(data).returning();
    for (const [key, weekdays, startTime, tokenLimit] of d.sched) {
      const [s] = await db.select().from(schedules).where(and(eq(schedules.doctorId, doc.id), eq(schedules.chamberId, ch[key]), eq(schedules.startTime, startTime)));
      if (!s) await db.insert(schedules).values({ doctorId: doc.id, chamberId: ch[key], weekdays, startTime, tokenLimit });
    }
  }
  const hash = await bcrypt.hash('demo1234', 10);
  for (const [username, key] of [['citymedicos', 'city'], ['lifeline', 'lifeline'], ['senclinic', 'sen'], ['royskin', 'roy']] as const) {
    await db.insert(agentAccounts).values({ username, passwordHash: hash, chamberId: ch[key] }).onConflictDoNothing();
  }
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  await seed();
  console.log('Seeded sample data');
  await pool.end();
}
