// All calendar dates are India time (Asia/Kolkata, UTC+05:30, no DST).
const IST_OFFSET_MIN = 330;

/** 'YYYY-MM-DD' for the IST calendar day of a moment. */
export function istDate(d: Date = new Date()): string {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return t.toISOString().slice(0, 10);
}

/** Add days to a 'YYYY-MM-DD' string. */
export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday for a 'YYYY-MM-DD'. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The UTC instant of an IST date + 'HH:MM'. */
export function istInstant(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCMinutes(h * 60 + m - IST_OFFSET_MIN);
  return t;
}

/** '17:00' -> '5:00 pm' */
export function prettyTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

/** '2026-11-27' -> 'Fri 27 Nov' */
export function prettyDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}
