// Gives the sample male doctors the sample cutout photo, only where no photo is set yet.
// Safe to run any number of times. Real photos will come from the admin panel.
import { and, inArray, isNull } from 'drizzle-orm';
import { db, pool, schema } from '../db.js';

export const SAMPLE_MALE_PHOTO = '/doctors/male-1.webp';
export const SAMPLE_MALE_DOCTORS = ['Dr. Amit Nath', 'Dr. Sujit Roy', 'Dr. Kamal Sinha'];

export async function setDemoPhotos() {
  const r = await db.update(schema.doctors).set({ photoUrl: SAMPLE_MALE_PHOTO })
    .where(and(inArray(schema.doctors.name, SAMPLE_MALE_DOCTORS), isNull(schema.doctors.photoUrl))).returning({ id: schema.doctors.id });
  return r.length;
}

if (process.argv[1]?.endsWith('demo-photos.ts') || process.argv[1]?.endsWith('demo-photos.js')) {
  console.log(`Photos set on ${await setDemoPhotos()} doctors`);
  await pool.end();
}
