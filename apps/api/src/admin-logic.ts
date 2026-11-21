import { and, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { notifyUser } from './notify.js';
import { broadcastSession } from './queue.js';
import { db, schema } from './db.js';
import { ensureSessions } from './sessions.js';
import { addDays, istDate, istInstant, prettyDate, weekday } from './time.js';
import { conflict } from './errors.js';

const { schedules, sessions, payments, tokens, chambers, settlements } = schema;

/**
 * After a schedule is added or changed, bring its future sittings in line.
 * Sittings that already have bookings keep their time; their limits never drop below what is already booked.
 * Days that are no longer in the schedule are cancelled only if nobody has booked them yet.
 */
export async function applySchedule(scheduleId: string) {
  const [sc] = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
  if (!sc) return { updated: 0, cancelled: 0, kept: 0 };
  const today = istDate();
  const future = await db.select().from(sessions).where(and(eq(sessions.scheduleId, scheduleId), gt(sessions.date, today)));
  const onlineLimit = Math.floor((sc.tokenLimit * sc.onlineShare) / 100);
  let updated = 0, cancelled = 0, kept = 0;
  for (const s of future) {
    const taken = s.onlineTaken + s.counterTaken;
    const wanted = sc.active && sc.weekdays.includes(weekday(s.date));
    if (!wanted) {
      if (taken === 0 && s.status !== 'CANCELLED') { await db.update(sessions).set({ status: 'CANCELLED' }).where(eq(sessions.id, s.id)); cancelled++; }
      else if (taken > 0) kept++;
      continue;
    }
    const patch: Partial<typeof sessions.$inferInsert> = {
      tokenLimit: Math.max(sc.tokenLimit, taken),
      onlineLimit: Math.max(onlineLimit, s.onlineTaken),
    };
    if (taken === 0) { patch.startTime = sc.startTime; patch.startsAt = istInstant(s.date, sc.startTime); }
    // A day put back into the schedule opens again (but never one the doctor cancelled).
    if (s.status === 'CANCELLED' && s.doctorStatus !== 'NOT_COMING') patch.status = 'OPEN';
    await db.update(sessions).set(patch).where(eq(sessions.id, s.id));
    updated++;
  }
  if (sc.active) await ensureSessions(addDays(today, 1), 35);
  return { updated, cancelled, kept };
}

/** Change the limits of one sitting. Limits cannot go below what is already booked. */
export async function setSessionLimits(sessionId: string, p: { tokenLimit?: number; onlineLimit?: number }) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for('update');
    if (!s) throw conflict('not_found', 'Sitting not found');
    const tokenLimit = p.tokenLimit ?? s.tokenLimit;
    const onlineLimit = p.onlineLimit ?? s.onlineLimit;
    if (tokenLimit < s.onlineTaken + s.counterTaken) throw conflict('below_taken', `${s.onlineTaken + s.counterTaken} serials are already given; the limit cannot be lower`);
    if (onlineLimit < s.onlineTaken) throw conflict('below_taken', `${s.onlineTaken} online serials are already booked; the online limit cannot be lower`);
    if (onlineLimit > tokenLimit) throw conflict('online_over_total', 'Online serials cannot be more than the total');
    const [row] = await tx.update(sessions).set({ tokenLimit, onlineLimit }).where(eq(sessions.id, sessionId)).returning();
    return row;
  });
}

/** Money for one day, per chamber, from online bookings of sittings on that day. */
export async function settlementPreview(date: string) {
  const rows = await db.select({
    chamberId: sessions.chamberId,
    status: payments.status,
    n: sql<number>`count(*)::int`,
    bookingFees: sql<number>`coalesce(sum(${payments.bookingFee}), 0)::int`,
    platformFees: sql<number>`coalesce(sum(${payments.platformFee}), 0)::int`,
    amount: sql<number>`coalesce(sum(${payments.amount}), 0)::int`,
  }).from(payments)
    .innerJoin(tokens, eq(tokens.id, payments.tokenId))
    .innerJoin(sessions, eq(sessions.id, tokens.sessionId))
    .where(and(eq(sessions.date, date), inArray(payments.status, ['PAID', 'REFUNDED'])))
    .groupBy(sessions.chamberId, payments.status);
  const all = await db.select({ id: chambers.id, name: chambers.name }).from(chambers);
  const out = new Map<string, { chamberId: string; chamber: string; bookings: number; bookingFees: number; platformFees: number; refunds: number; amount: number }>();
  for (const r of rows) {
    const c = out.get(r.chamberId) ?? { chamberId: r.chamberId, chamber: all.find((x) => x.id === r.chamberId)?.name ?? '', bookings: 0, bookingFees: 0, platformFees: 0, refunds: 0, amount: 0 };
    if (r.status === 'PAID') { c.bookings += r.n; c.bookingFees += r.bookingFees; c.platformFees += r.platformFees; c.amount += r.bookingFees; }
    else c.refunds += r.amount;
    out.set(r.chamberId, c);
  }
  return [...out.values()].sort((a, b) => a.chamber.localeCompare(b.chamber));
}

/** Save the day's settlement rows (once per chamber per day). Paid rows are never changed. */
export async function generateSettlements(date: string) {
  if (date >= istDate()) throw conflict('too_early', 'A day can be settled only after it is over');
  const list = await settlementPreview(date);
  for (const r of list) {
    await db.insert(settlements).values({ chamberId: r.chamberId, date, bookings: r.bookings, bookingFees: r.bookingFees, platformFees: r.platformFees, refunds: r.refunds, amount: r.amount })
      .onConflictDoUpdate({
        target: [settlements.chamberId, settlements.date],
        set: { bookings: r.bookings, bookingFees: r.bookingFees, platformFees: r.platformFees, refunds: r.refunds, amount: r.amount },
        setWhere: eq(settlements.status, 'PENDING'),
      });
  }
  return list.length;
}

/** Runs from the server timer: settles yesterday once it is over. */
export async function autoSettle() {
  return generateSettlements(addDays(istDate(), -1));
}

/**
 * Stop a sitting for good (admin removed it, or removed its doctor or chamber).
 * Upcoming days nobody booked are cancelled. Days with bookings are cancelled too, and each online
 * patient is told and can move the serial to another sitting for free (our side changed, so no fee).
 * Today's sitting is left to the counter, so a running queue is never cut off.
 */
export async function removeSchedule(scheduleId: string) {
  const [sc] = await db.update(schedules).set({ active: false, removedAt: new Date() }).where(eq(schedules.id, scheduleId)).returning();
  if (!sc) return { cancelled: 0, patients: 0 };
  const [doc] = await db.select().from(schema.doctors).where(eq(schema.doctors.id, sc.doctorId));
  const [room] = await db.select().from(chambers).where(eq(chambers.id, sc.chamberId));
  const future = await db.select().from(sessions).where(and(eq(sessions.scheduleId, scheduleId), gt(sessions.date, istDate()), inArray(sessions.status, ['OPEN', 'CLOSED'])));
  let patients = 0;
  for (const s of future) {
    await db.update(sessions).set({ status: 'CANCELLED', doctorStatus: 'NOT_COMING' }).where(eq(sessions.id, s.id));
    const waiting = await db.select().from(tokens).where(and(eq(tokens.sessionId, s.id), inArray(tokens.state, ['BOOKED', 'ARRIVED']), eq(tokens.source, 'ONLINE'), isNotNull(tokens.userId)));
    for (const t of waiting) {
      await db.update(tokens).set({ absentChoice: 'pending' }).where(eq(tokens.id, t.id));
      await notifyUser(t.userId!, 'not_coming', `${doc?.name ?? 'The doctor'} will not sit at ${room?.name ?? 'this chamber'} on ${prettyDate(s.date)}`, 'Pick another sitting in the app. Moving is free.', { tokenId: t.id });
      patients++;
    }
    await broadcastSession(s.id);
  }
  return { cancelled: future.length, patients };
}

/** Add a sitting and open its upcoming days. */
export async function createSchedule(doctorId: string, b: { chamberId: string; weekdays: number[]; startTime: string; tokenLimit: number; onlineShare: number; active?: boolean }) {
  const [row] = await db.insert(schedules).values({ ...b, doctorId }).returning();
  const result = await applySchedule(row.id);
  return { schedule: row, result };
}

/** Remove a doctor: every sitting stops (patients told, free move), and they leave the app and admin lists. */
export async function removeDoctor(doctorId: string) {
  const list = await db.select().from(schedules).where(and(eq(schedules.doctorId, doctorId), isNull(schedules.removedAt)));
  let cancelled = 0, patients = 0;
  for (const sc of list) { const r = await removeSchedule(sc.id); cancelled += r.cancelled; patients += r.patients; }
  await db.update(schema.doctors).set({ visible: false, removedAt: new Date() }).where(eq(schema.doctors.id, doctorId));
  return { sittings: list.length, cancelled, patients };
}

/** Remove a chamber: every sitting there stops, its counter logins are switched off, and it leaves the app. */
export async function removeChamber(chamberId: string) {
  const list = await db.select().from(schedules).where(and(eq(schedules.chamberId, chamberId), isNull(schedules.removedAt)));
  let cancelled = 0, patients = 0;
  for (const sc of list) { const r = await removeSchedule(sc.id); cancelled += r.cancelled; patients += r.patients; }
  await db.update(chambers).set({ visible: false, removedAt: new Date() }).where(eq(chambers.id, chamberId));
  await db.update(schema.agentAccounts).set({ active: false }).where(eq(schema.agentAccounts.chamberId, chamberId));
  return { sittings: list.length, cancelled, patients };
}
