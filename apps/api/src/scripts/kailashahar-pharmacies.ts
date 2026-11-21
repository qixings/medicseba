// Bring in the real Kailashahar pharmacies (from Google Maps, November 2026) and remove the demo chambers.
//
//   npx tsx src/scripts/kailashahar-pharmacies.ts           shows what would change, changes nothing
//   npx tsx src/scripts/kailashahar-pharmacies.ts --apply   makes the changes
//
// - Pharmacies already in the system (matched by name, e.g. Biswajit, Paul) are kept as they are;
//   only empty fields (phone, map location, hours, landmark) are filled in.
// - The rest are added as visible pharmacies with the standard ₹55 + ₹10 fees.
// - Only the four demo chambers from the seed are removed. Doctors are never removed: any sitting a doctor
//   has at a demo chamber stops, and patients who booked it are told and can move for free.
// Safe to run again: nothing is added twice.
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db, pool, schema } from '../db.js';
import { removeChamber } from '../admin-logic.js';
import { istDate } from '../time.js';

const { chambers, schedules, doctors, sessions } = schema;

type P = { name: string; match: RegExp; address: string; area: string; landmark?: string; phone?: string; lat: number; lng: number; hours?: string };

const PHARMACIES: P[] = [
  { name: 'Unakoti Medical Hall', match: /unakoti\s*medical/i, address: 'Girls School Road, Chandipur, Kailashahar', area: 'Chandipur', landmark: 'Near SBI', phone: '+91 89744 76483', lat: 24.320991, lng: 91.997695, hours: '00:00-24:00' },
  { name: 'Biswajit Medicine Centre', match: /biswajit/i, address: 'Chandipur, Kailashahar', area: 'Chandipur', landmark: 'Near Nirmala Hotel, close to Netaji Corner', phone: '+91 94023 38249', lat: 24.3196415, lng: 91.9976888 },
  { name: 'Bishal Medical Hall', match: /bishal/i, address: 'Kailashahar Bazar, Kailashahar', area: 'Kailashahar Bazar', phone: '+91 94365 01529', lat: 24.320174, lng: 91.9976981 },
  { name: 'New Shome Medical Hall', match: /shome/i, address: 'Girls School Road, Kailashahar', area: 'Girls School Road', phone: '+91 98622 39869', lat: 24.3207032, lng: 91.997746, hours: '09:30-22:30' },
  { name: 'One Life Pharmacy', match: /one\s*life/i, address: 'Jamamarjij Road, Chandipur, Kailashahar', area: 'Chandipur', phone: '+91 93536 10322', lat: 24.3204945, lng: 91.9960051 },
  { name: 'New Medlife Pharma', match: /medlife/i, address: 'Central Road, Kailashahar', area: 'Central Road', lat: 24.3187786, lng: 91.9997676 },
  { name: 'Saha Medical Hall', match: /saha\s*medical/i, address: 'Kailashahar town', area: 'Town centre', lat: 24.3184087, lng: 92.0007046 },
  { name: 'Roy Medical Stores', match: /roy\s*medical/i, address: 'Kailashahar town', area: 'Town centre', phone: '+91 90438 74554', lat: 24.3185022, lng: 92.0006162 },
  { name: 'Day Night Medical Hall', match: /day\s*night/i, address: 'Kailashahar town', area: 'Town centre', lat: 24.318272, lng: 92.0019464 },
  { name: 'Paul Drug House', match: /paul/i, address: 'Kumarghat-Kailashahar Road, Paitubazar, Kailashahar', area: 'New Motor Stand', landmark: 'New Motor Stand', phone: '+91 94369 16869', lat: 24.3171328, lng: 92.0052781, hours: '07:00-22:00' },
  { name: 'Tannishtha Medicine Centre', match: /tann?ishtha/i, address: 'Dharmanagar-Kailashahar Road, Kailashahar', area: 'Dharmanagar Road', phone: '+91 98624 51915', lat: 24.3164415, lng: 92.0059887 },
  { name: 'Astha Medical Hall', match: /astha/i, address: 'Hospital Road, Kailashahar', area: 'Hospital Road', phone: '+91 3824 223061', lat: 24.3267454, lng: 92.0129265, hours: '08:30-22:00' },
  { name: 'Unakoti Ayurveda', match: /unakoti\s*ayur/i, address: 'RGM Hospital Road, Kailashahar', area: 'RGM Hospital Road', phone: '+91 98629 77685', lat: 24.3182954, lng: 92.0023385, hours: '10:00-21:00' },
  { name: 'Jan Aushadhi Store', match: /jan\s*aushadhi/i, address: 'District Hospital Complex, Bhagaban Nagar, Kailashahar', area: 'Bhagaban Nagar', landmark: 'Inside the District Hospital complex', phone: '+91 94369 34274', lat: 24.3045817, lng: 92.0334044 },
  { name: 'Family Pharma', match: /family\s*pharma/i, address: 'Dharmanagar-Kailashahar Road, Gournagar', area: 'Gournagar', lat: 24.3064144, lng: 92.0271641, hours: '07:30-22:30' },
  { name: 'Modern Medical', match: /modern\s*medical/i, address: 'Dharmanagar-Kailashahar Road, Gournagar', area: 'Gournagar', lat: 24.3040973, lng: 92.033666 },
  { name: 'Ayesha Medical', match: /ayesha/i, address: 'Opposite BDO Office, Gournagar', area: 'Gournagar', landmark: 'Opposite the BDO Office', phone: '+91 76408 20446', lat: 24.2944649, lng: 92.0257602, hours: '10:00-23:00' },
];

/** The demo chambers created by the seed. Nothing else is ever removed. */
const DEMO = ['City Medicos', 'Lifeline Pharmacy', 'Sen Clinic', 'Dr. Roy Skin Care'];

const apply = process.argv.includes('--apply');

async function main() {
  const existing = await db.select().from(chambers).where(isNull(chambers.removedAt));
  const used = new Set<string>();
  const toAdd: P[] = [];
  const toFill: { id: string; name: string; patch: Partial<typeof chambers.$inferInsert>; as: string }[] = [];

  for (const p of PHARMACIES) {
    const hit = existing.find((c) => !DEMO.includes(c.name) && !used.has(c.id) && p.match.test(c.name));
    if (!hit) { toAdd.push(p); continue; }
    used.add(hit.id);
    const patch: Partial<typeof chambers.$inferInsert> = {};
    if (!hit.phone && p.phone) patch.phone = p.phone;
    if (hit.lat == null || hit.lng == null) { patch.lat = p.lat; patch.lng = p.lng; }
    if (!hit.landmark && p.landmark) patch.landmark = p.landmark;
    if (!hit.openingHours && p.hours) patch.openingHours = p.hours;
    toFill.push({ id: hit.id, name: hit.name, patch, as: p.name });
  }

  const demo = existing.filter((c) => DEMO.includes(c.name));
  const others = existing.filter((c) => !DEMO.includes(c.name) && !used.has(c.id));

  console.log(apply ? '\nMaking these changes:\n' : '\nPreview only. Nothing is changed until you run it again with --apply.\n');

  console.log(`Already in the system, kept (${toFill.length}):`);
  for (const f of toFill) {
    const fields = Object.keys(f.patch).filter((k) => k !== 'lng').map((k) => (k === 'lat' ? 'map location' : k === 'openingHours' ? 'hours' : k));
    console.log(`  ${f.name}  (matches "${f.as}")${fields.length ? `, filling in: ${fields.join(', ')}` : ', nothing to fill in'}`);
  }

  console.log(`\nNew pharmacies to add (${toAdd.length}):`);
  for (const p of toAdd) console.log(`  ${p.name}, ${p.area}${p.phone ? `, ${p.phone}` : ''}`);

  console.log(`\nDemo chambers to remove (${demo.length}):`);
  const today = istDate();
  for (const c of demo) {
    const sits = await db.select({ doctor: doctors.name, id: schedules.id }).from(schedules).innerJoin(doctors, eq(doctors.id, schedules.doctorId))
      .where(and(eq(schedules.chamberId, c.id), isNull(schedules.removedAt)));
    const upcoming = sits.length
      ? await db.select({ online: sessions.onlineTaken, counter: sessions.counterTaken }).from(sessions).where(and(inArray(sessions.scheduleId, sits.map((s) => s.id)), gt(sessions.date, today)))
      : [];
    const booked = upcoming.reduce((n, s) => n + s.online + s.counter, 0);
    console.log(`  ${c.name}${sits.length ? `: sittings of ${[...new Set(sits.map((s) => s.doctor))].join(', ')} stop` : ', no sittings'}${booked ? `, ${booked} upcoming serial${booked > 1 ? 's' : ''} (patients told, free move)` : ''}`);
  }
  if (demo.some(() => true)) console.log('  Doctors are kept. If a real doctor sits at one of these, move the sitting to a real pharmacy in the admin panel first, then run this.');

  console.log(`\nLeft exactly as they are (${others.length}):`);
  for (const c of others) console.log(`  ${c.name}`);

  if (!apply) { console.log('\nTo make these changes: npx tsx src/scripts/kailashahar-pharmacies.ts --apply\n'); return; }

  for (const f of toFill) if (Object.keys(f.patch).length) await db.update(chambers).set(f.patch).where(eq(chambers.id, f.id));
  for (const p of toAdd) {
    await db.insert(chambers).values({
      name: p.name, kind: 'PHARMACY', address: p.address, area: p.area, landmark: p.landmark ?? '', phone: p.phone ?? '',
      lat: p.lat, lng: p.lng, openingHours: p.hours ?? '', visible: true,
    });
  }
  for (const c of demo) await removeChamber(c.id);
  console.log(`\nDone: ${toAdd.length} added, ${toFill.length} kept, ${demo.length} demo chambers removed.`);
  console.log('Next: give each pharmacy a counter login, and add its doctors, in the admin panel.\n');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
