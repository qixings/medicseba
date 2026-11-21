import type { Chamber, Doctor, Specialty } from './schema.js';
import { istDate } from './time.js';

export function doctorView(d: Doctor, specialty: Specialty) {
  return {
    id: d.id,
    name: d.name,
    photoUrl: d.photoUrl,
    degrees: d.degrees,
    specialty: { slug: specialty.slug, name: specialty.name },
    experienceYears: d.experienceYears,
    consultFee: d.consultFee,
    languages: d.languages,
    bio: d.bio,
    bookingWindowDays: d.bookingWindowDays,
    // An average only means something after a handful of ratings.
    rating: d.ratingCount >= 5 ? Math.round((d.ratingSum / d.ratingCount) * 10) / 10 : null,
    ratingCount: d.ratingCount,
  };
}

/** openingHours is stored as 'HH:MM-HH:MM' (India time). */
export function isOpenNow(hours: string, now = new Date()) {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(hours);
  if (!m) return null;
  const ist = new Date(now.getTime() + 330 * 60_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const open = +m[1] * 60 + +m[2];
  const close = +m[3] * 60 + +m[4];
  return mins >= open && mins < close;
}

export function chamberView(c: Chamber) {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    photos: c.photos,
    address: c.address,
    area: c.area,
    landmark: c.landmark,
    lat: c.lat,
    lng: c.lng,
    phone: c.phone,
    openingHours: c.openingHours,
    openNow: isOpenNow(c.openingHours),
    bookingFee: c.bookingFee,
    platformFee: c.platformFee,
    total: c.bookingFee + c.platformFee,
  };
}

export const today = () => istDate();
