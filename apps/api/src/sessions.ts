import { eq } from 'drizzle-orm';
import { db, schema } from './db.js';
import type { Chamber, Session } from './schema.js';
import { addDays, istDate, istInstant, prettyTime, weekday } from './time.js';

/** Create sessions from weekly schedules for [from, from + days). Safe to call repeatedly. */
export async function ensureSessions(from = istDate(), days = 30) {
  const list = await db.select().from(schema.schedules).where(eq(schema.schedules.active, true));
  const rows: (typeof schema.sessions.$inferInsert)[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const wd = weekday(date);
    for (const s of list) {
      if (!s.weekdays.includes(wd)) continue;
      rows.push({
        scheduleId: s.id, doctorId: s.doctorId, chamberId: s.chamberId, date, startTime: s.startTime,
        startsAt: istInstant(date, s.startTime), tokenLimit: s.tokenLimit,
        onlineLimit: Math.floor((s.tokenLimit * s.onlineShare) / 100),
      });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(schema.sessions).values(rows.slice(i, i + 500)).onConflictDoNothing();
  }
}

export function onlineLeft(s: Session) {
  return Math.max(0, Math.min(s.onlineLimit - s.onlineTaken, s.tokenLimit - s.onlineTaken - s.counterTaken));
}

export function isBookable(s: Session, windowDays: number, today = istDate()) {
  if (s.status !== 'OPEN') return false;
  if (s.date < today) return false;
  if (s.date > addDays(today, Math.max(0, windowDays - 1))) return false;
  if (s.doctorStatus === 'NOT_COMING' || s.doctorStatus === 'ENDED') return false;
  return onlineLeft(s) > 0;
}

/** Public shape of a session for the apps. */
export function sessionView(s: Session, chamber: Chamber, windowDays: number) {
  const left = onlineLeft(s);
  return {
    id: s.id,
    date: s.date,
    time: prettyTime(s.startTime),
    startTime: s.startTime,
    startsAt: s.startsAt,
    chamber: { id: chamber.id, name: chamber.name, area: chamber.area },
    tokensLeft: left,
    full: left === 0,
    bookable: isBookable(s, windowDays),
    status: s.status,
    doctorStatus: s.doctorStatus,
  };
}
