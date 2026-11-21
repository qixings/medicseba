import { and, asc, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema, type Tx } from './db.js';
import { env } from './env.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { createOrder, refund, verifyCheckout } from './payments.js';
import { isBookable, onlineLeft } from './sessions.js';
import { notifyUser } from './notify.js';
import { broadcastSession, checkAheadAlerts } from './queue.js';
import { prettyDate, prettyTime } from './time.js';
import type { DoctorStatus, Session, TokenState } from './schema.js';

const { sessions, tokens, payments, familyMembers, doctors, chambers } = schema;
const MAX_PER_PHONE = 4;
const ACTIVE: TokenState[] = ['HELD', 'BOOKED', 'ARRIVED', 'SERVING'];
import type { AnyColumn } from 'drizzle-orm';
const inc = (col: AnyColumn, by = 1) => sql`${col} + ${by}`;

/** Next place at the end of a sitting's line (call inside the transaction that locked the sitting). */
async function endOfLine(tx: Tx, sessionId: string) {
  const [{ m }] = await tx.select({ m: sql<number>`coalesce(max(${tokens.queuePos}), 0)::int` }).from(tokens).where(eq(tokens.sessionId, sessionId));
  return m + 1;
}

/** Lock a session row for the rest of the transaction. */
async function lockSession(tx: Tx, id: string): Promise<Session> {
  const [s] = await tx.select().from(sessions).where(eq(sessions.id, id)).for('update');
  if (!s) throw notFound('Session');
  return s;
}

async function windowFor(tx: Tx, doctorId: string) {
  const [d] = await tx.select().from(doctors).where(eq(doctors.id, doctorId));
  if (!d || !d.visible) throw notFound('Doctor');
  return d.bookingWindowDays;
}

async function sessionWithRefs(id: string) {
  const [r] = await db.select().from(sessions).innerJoin(doctors, eq(doctors.id, sessions.doctorId)).innerJoin(chambers, eq(chambers.id, sessions.chamberId)).where(eq(sessions.id, id));
  if (!r) throw notFound('Session');
  return { session: r.sessions, doctor: r.doctors, chamber: r.chambers };
}

/** Step 1: reserve a place for a few minutes while the patient pays. */
export async function holdToken(userId: string, sessionId: string, memberId: string) {
  const [member] = await db.select().from(familyMembers).where(and(eq(familyMembers.id, memberId), eq(familyMembers.userId, userId), sql`${familyMembers.deletedAt} is null`));
  if (!member) throw notFound('Patient');

  const token = await db.transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (!isBookable(s, await windowFor(tx, s.doctorId))) {
      const full = onlineLeft(s) === 0;
      throw conflict(full ? 'session_full' : 'session_closed', full ? 'This sitting is full' : 'Booking is closed for this sitting');
    }
    const mine = await tx.select().from(tokens).where(and(eq(tokens.sessionId, sessionId), eq(tokens.userId, userId), inArray(tokens.state, ACTIVE)));
    if (mine.some((t) => t.memberId === memberId)) throw conflict('already_booked', `${member.name} already has a serial for this sitting`);
    if (mine.length >= MAX_PER_PHONE) throw conflict('phone_limit', `One phone can book up to ${MAX_PER_PHONE} tokens per session`);
    await tx.update(sessions).set({ onlineTaken: inc(sessions.onlineTaken) }).where(eq(sessions.id, s.id));
    const [t] = await tx.insert(tokens).values({
      sessionId, source: 'ONLINE', state: 'HELD', userId, memberId,
      patientName: member.name, patientAge: member.age, patientGender: member.gender,
      holdExpiresAt: new Date(Date.now() + env.holdMinutes * 60_000),
    }).returning();
    return t;
  });

  const { chamber } = await sessionWithRefs(sessionId);
  const amount = chamber.bookingFee + chamber.platformFee;
  const order = await createOrder(amount, token.id);
  await db.insert(payments).values({ tokenId: token.id, amount, bookingFee: chamber.bookingFee, platformFee: chamber.platformFee, provider: order.provider, providerOrderId: order.orderId });
  return { tokenId: token.id, holdExpiresAt: token.holdExpiresAt, amount, bookingFee: chamber.bookingFee, platformFee: chamber.platformFee, order };
}

/** Step 2: payment succeeded, so give the patient a token number. Safe to call twice. */
export async function confirmPayment(orderId: string, paymentId: string, signature: string | null) {
  const [pay] = await db.select().from(payments).where(eq(payments.providerOrderId, orderId));
  if (!pay) throw notFound('Order');
  if (signature !== null) verifyCheckout(orderId, paymentId, signature);
  const [existing] = await db.select().from(tokens).where(eq(tokens.id, pay.tokenId));
  if (existing.state !== 'HELD' && existing.state !== 'EXPIRED') return existing;

  const result = await db.transaction(async (tx) => {
    const s = await lockSession(tx, existing.sessionId);
    const [t] = await tx.select().from(tokens).where(eq(tokens.id, existing.id));
    if (t.state !== 'HELD' && t.state !== 'EXPIRED') return { token: t, lateFail: false };
    if (t.state === 'EXPIRED') {
      // Paid after the hold ran out: take the place again if there is still room.
      if (s.status !== 'OPEN' || onlineLeft(s) === 0) {
        await tx.update(payments).set({ status: 'PAID', providerPaymentId: paymentId }).where(eq(payments.id, pay.id));
        return { token: t, lateFail: true };
      }
      await tx.update(sessions).set({ onlineTaken: inc(sessions.onlineTaken) }).where(eq(sessions.id, s.id));
    }
    await tx.update(sessions).set({ nextNumber: inc(sessions.nextNumber) }).where(eq(sessions.id, s.id));
    await tx.update(payments).set({ status: 'PAID', providerPaymentId: paymentId }).where(eq(payments.id, pay.id));
    const [token] = await tx.update(tokens).set({ state: 'BOOKED', number: s.nextNumber, queuePos: await endOfLine(tx, s.id), holdExpiresAt: null }).where(eq(tokens.id, t.id)).returning();
    return { token, lateFail: false };
  });

  if (result.lateFail) {
    await refundToken(result.token.id);
    throw conflict('session_full', `The sitting filled up while you were paying. Your ₹${pay.amount} is being refunded`);
  }
  const t = result.token;
  const { session: s, doctor, chamber } = await sessionWithRefs(t.sessionId);
  if (t.userId) await notifyUser(t.userId, 'booked', `Serial ${t.number} booked`, `${doctor.name}, ${chamber.name}, ${prettyDate(s.date)}, ${prettyTime(s.startTime)}`, { tokenId: t.id });
  await broadcastSession(s.id);
  return t;
}

/** Hold timed out without payment: free the place. */
export async function releaseExpiredHolds() {
  const expired = await db.select({ id: tokens.id, sessionId: tokens.sessionId }).from(tokens).where(and(eq(tokens.state, 'HELD'), lt(tokens.holdExpiresAt, new Date())));
  for (const e of expired) {
    await db.transaction(async (tx) => {
      await lockSession(tx, e.sessionId);
      const done = await tx.update(tokens).set({ state: 'EXPIRED' }).where(and(eq(tokens.id, e.id), eq(tokens.state, 'HELD'))).returning({ id: tokens.id });
      if (done.length) await tx.update(sessions).set({ onlineTaken: inc(sessions.onlineTaken, -1) }).where(eq(sessions.id, e.sessionId));
    });
  }
  return expired.length;
}

async function ownedToken(userId: string, tokenId: string) {
  const [r] = await db.select().from(tokens).innerJoin(sessions, eq(sessions.id, tokens.sessionId)).leftJoin(payments, eq(payments.tokenId, tokens.id)).where(eq(tokens.id, tokenId));
  if (!r) throw notFound('Booking');
  if (r.tokens.userId !== userId) throw forbidden();
  return { ...r.tokens, session: r.sessions, payment: r.payments };
}

/** Move a booked token to another session of the same doctor. */
async function moveToken(tokenId: string, targetSessionId: string, opts: { countAsReschedule: boolean; states?: TokenState[] }) {
  const [t0] = await db.select().from(tokens).where(eq(tokens.id, tokenId));
  if (t0.sessionId === targetSessionId) throw badRequest('same_session', 'Pick a different sitting');
  const [a, b] = [t0.sessionId, targetSessionId].sort();
  const moved = await db.transaction(async (tx) => {
    const sa = await lockSession(tx, a);
    const sb = await lockSession(tx, b);
    const from = sa.id === t0.sessionId ? sa : sb;
    const to = sa.id === targetSessionId ? sa : sb;
    if (to.doctorId !== from.doctorId) throw badRequest('other_doctor', 'You can only move to a sitting of the same doctor');
    if (!isBookable(to, await windowFor(tx, to.doctorId))) throw conflict('session_full', 'That sitting is full or closed');
    const [t] = await tx.select().from(tokens).where(eq(tokens.id, tokenId));
    if (!(opts.states ?? ['BOOKED']).includes(t.state)) throw conflict('not_movable', 'This booking can no longer be moved');
    await tx.update(tokens).set({ state: 'MOVED', absentChoice: t.absentChoice ? 'move' : null }).where(eq(tokens.id, t.id));
    if (from.status !== 'CANCELLED') await tx.update(sessions).set({ onlineTaken: inc(sessions.onlineTaken, -1) }).where(eq(sessions.id, from.id));
    await tx.update(sessions).set({ onlineTaken: inc(sessions.onlineTaken), nextNumber: inc(sessions.nextNumber) }).where(eq(sessions.id, to.id));
    const [created] = await tx.insert(tokens).values({
      sessionId: to.id, number: to.nextNumber, queuePos: await endOfLine(tx, to.id), source: 'ONLINE', state: 'BOOKED', userId: t.userId, memberId: t.memberId,
      patientName: t.patientName, patientAge: t.patientAge, patientGender: t.patientGender,
      rescheduleUsed: opts.countAsReschedule || t.rescheduleUsed, movedFromId: t.id,
    }).returning();
    await tx.update(payments).set({ tokenId: created.id }).where(eq(payments.tokenId, t.id));
    return created;
  });
  await broadcastSession(t0.sessionId);
  await broadcastSession(targetSessionId);
  return moved;
}

export async function reschedule(userId: string, tokenId: string, targetSessionId: string) {
  const t = await ownedToken(userId, tokenId);
  if (t.state !== 'BOOKED') throw conflict('not_movable', 'Only booked serials can be moved');
  if (t.rescheduleUsed) throw conflict('reschedule_used', 'This booking was already moved once');
  if (Date.now() > t.session.startsAt.getTime() - env.rescheduleCutoffMinutes * 60_000) {
    throw conflict('too_late', `Bookings can be moved up to ${env.rescheduleCutoffMinutes / 60} hours before the sitting`);
  }
  const moved = await moveToken(tokenId, targetSessionId, { countAsReschedule: true });
  await notifyUser(userId, 'moved', `Booking moved, serial ${moved.number}`, 'Your booking was moved to a new sitting', { tokenId: moved.id });
  return moved;
}

export async function cancelBooking(userId: string, tokenId: string) {
  const t = await ownedToken(userId, tokenId);
  if (t.state !== 'BOOKED') throw conflict('not_cancellable', 'This booking can no longer be cancelled');
  await db.transaction(async (tx) => {
    await lockSession(tx, t.sessionId);
    await tx.update(tokens).set({ state: 'CANCELLED' }).where(eq(tokens.id, t.id));
    await tx.update(sessions).set({ onlineTaken: inc(sessions.onlineTaken, -1) }).where(eq(sessions.id, t.sessionId));
  });
  await broadcastSession(t.sessionId);
  return { ok: true, refunded: false };
}

export async function refundToken(tokenId: string) {
  const [pay] = await db.select().from(payments).where(eq(payments.tokenId, tokenId));
  if (pay && pay.status !== 'REFUNDED') {
    const refundId = await refund(pay.providerPaymentId, pay.amount);
    await db.update(payments).set({ status: 'REFUNDED', providerRefundId: refundId }).where(eq(payments.id, pay.id));
  }
  const [t] = await db.update(tokens).set({ state: 'REFUNDED', absentChoice: 'refund' }).where(eq(tokens.id, tokenId)).returning();
  return t;
}

/**
 * After the doctor cancels, the patient moves the booking to another sitting for free.
 * MedicSeba has a no-refund policy: problems on our side are fixed by moving the serial, not by refunds.
 */
export async function absentChoice(userId: string, tokenId: string, targetSessionId: string) {
  const t = await ownedToken(userId, tokenId);
  if (t.absentChoice !== 'pending' || !['BOOKED', 'ARRIVED'].includes(t.state)) throw conflict('no_choice', 'There is nothing to choose for this booking');
  const moved = await moveToken(t.id, targetSessionId, { countAsReschedule: false, states: ['BOOKED', 'ARRIVED'] });
  await notifyUser(userId, 'moved', `Moved, serial ${moved.number}`, 'Your booking was moved to the sitting you picked', { tokenId: moved.id });
  return moved;
}

/** The team moves a booking (for example the doctor did not come, or the patient called support). Free, and it does not use up the patient's own reschedule. */
export async function adminMove(tokenId: string, targetSessionId: string) {
  const [t] = await db.select().from(tokens).where(eq(tokens.id, tokenId));
  if (!t) throw notFound('Booking');
  const moved = await moveToken(tokenId, targetSessionId, { countAsReschedule: false, states: ['BOOKED', 'ARRIVED', 'MISSED'] });
  if (t.userId) {
    const { doctor, chamber, session } = await sessionWithRefs(moved.sessionId);
    await notifyUser(t.userId, 'moved', `Moved, serial ${moved.number}`, `${doctor.name}, ${chamber.name}, ${prettyDate(session.date)} ${prettyTime(session.startTime)}`, { tokenId: moved.id });
  }
  return moved;
}

/* ---------------- chamber agent actions ---------------- */

async function agentSession(chamberId: string, sessionId: string) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!s) throw notFound('Session');
  if (s.chamberId !== chamberId) throw forbidden();
  return s;
}

export async function addWalkIn(chamberId: string, sessionId: string, p: { name: string; age?: number; gender?: 'MALE' | 'FEMALE' | 'OTHER'; phone?: string; clientRef?: string; paidAmount?: number; paidMethod?: 'CASH' | 'UPI' }) {
  await agentSession(chamberId, sessionId);
  if (p.clientRef) {
    // Already added (the app retried after going offline): return the same token.
    const [dup] = await db.select().from(tokens).where(eq(tokens.clientRef, p.clientRef));
    if (dup) return dup;
  }
  const t = await db.transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (s.status === 'CANCELLED' || s.status === 'ENDED') throw conflict('session_closed', 'This sitting is over');
    if (s.onlineTaken + s.counterTaken >= s.tokenLimit) throw conflict('session_full', 'No serials left in this sitting');
    await tx.update(sessions).set({ counterTaken: inc(sessions.counterTaken), nextNumber: inc(sessions.nextNumber) }).where(eq(sessions.id, s.id));
    const [row] = await tx.insert(tokens).values({
      sessionId, number: s.nextNumber, queuePos: await endOfLine(tx, sessionId), source: 'WALKIN', state: 'ARRIVED', patientName: p.name,
      paidAmount: p.paidAmount, paidMethod: p.paidMethod,
      patientAge: p.age, patientGender: p.gender, phone: p.phone, clientRef: p.clientRef,
    }).returning();
    return row;
  });
  await broadcastSession(sessionId);
  return t;
}

/**
 * Finish the current patient and call the next one in line.
 * current = 'DONE': seen by the doctor. current = 'MISSED': called but not there (see markNotThere).
 * `expect` is the serial the counter saw being served. If the queue has already moved (a retry after being
 * offline, or two phones at one counter), nothing happens, so a patient is never skipped by accident.
 */
export async function callNext(chamberId: string, sessionId: string, opts: { expect?: number; current?: 'DONE' | 'MISSED' } = {}) {
  await agentSession(chamberId, sessionId);
  const notes: Note[] = [];
  const next = await db.transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (s.status === 'ENDED' || s.status === 'CANCELLED') throw conflict('session_over', 'This sitting has ended. Turn it back on to call patients.');
    if (opts.expect !== undefined && s.servingNumber !== opts.expect) return null;
    const [cur] = await tx.select().from(tokens).where(and(eq(tokens.sessionId, sessionId), eq(tokens.state, 'SERVING')));
    if (cur) {
      if (opts.current === 'MISSED') notes.push(await markNotThere(tx, cur));
      else await tx.update(tokens).set({ state: 'DONE', doneAt: new Date() }).where(eq(tokens.id, cur.id));
    }
    // Always the first in line: a patient called out of order never makes the counter skip anyone.
    const [n] = await tx.select().from(tokens)
      .where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, ['BOOKED', 'ARRIVED']), isNotNull(tokens.number)))
      .orderBy(asc(tokens.queuePos)).limit(1);
    if (!n) { await tx.update(sessions).set({ servingNumber: 0 }).where(eq(sessions.id, s.id)); return null; }
    await tx.update(tokens).set({ state: 'SERVING', servedAt: new Date() }).where(eq(tokens.id, n.id));
    const ds: DoctorStatus = s.doctorStatus === 'ON_TIME' || s.doctorStatus === 'LATE' ? 'ARRIVED' : s.doctorStatus;
    await tx.update(sessions).set({ servingNumber: n.number!, doctorStatus: ds, arrivedAt: s.arrivedAt ?? new Date() }).where(eq(sessions.id, s.id));
    return n;
  });
  await sendNotes(notes);
  await broadcastSession(sessionId);
  await checkAheadAlerts(sessionId);
  return next;
}

type Note = { userId: string | null; kind: 'requeued' | 'missed'; tokenId: string; number: number | null; chamber?: string } | null;

/**
 * Called but not there. First time: back to the end of the line. Second time: missed
 * (the counter can still call them in by hand if they turn up).
 */
async function markNotThere(tx: Tx, t: typeof tokens.$inferSelect): Promise<Note> {
  if (t.missCount === 0) {
    await tx.update(tokens).set({ state: 'BOOKED', missCount: 1, queuePos: await endOfLine(tx, t.sessionId) }).where(eq(tokens.id, t.id));
    return { userId: t.userId, kind: 'requeued', tokenId: t.id, number: t.number };
  }
  await tx.update(tokens).set({ state: 'MISSED', missCount: t.missCount + 1 }).where(eq(tokens.id, t.id));
  return { userId: t.userId, kind: 'missed', tokenId: t.id, number: t.number };
}

async function sendNotes(notes: Note[]) {
  for (const n of notes) {
    if (!n?.userId) continue;
    if (n.kind === 'requeued') await notifyUser(n.userId, 'requeued', `You were not there for serial ${n.number}`, 'You are now at the end of the line. Reach the chamber and tell the counter.', { tokenId: n.tokenId });
    else await notifyUser(n.userId, 'missed', `Serial ${n.number} missed`, 'You were called twice and were not there. Ask the counter if the doctor can still see you.', { tokenId: n.tokenId });
  }
}

export type TokenAction = 'arrived' | 'missed' | 'done' | 'call' | 'restore';

/**
 * Counter actions on one serial. All of them are safe to repeat.
 * - arrived: patient is at the chamber
 * - missed: not there (first time to the end of the line, second time missed)
 * - call: call this patient now (a missed patient who came back, or out of order)
 * - done: finished with the doctor
 * - restore: a missed patient came back; they go to the end of the line
 */
export async function tokenAction(chamberId: string, tokenId: string, action: TokenAction) {
  const [t] = await db.select().from(tokens).where(eq(tokens.id, tokenId));
  if (!t || t.number === null) throw notFound('Serial');
  await agentSession(chamberId, t.sessionId);
  const notes: Note[] = [];
  await db.transaction(async (tx) => {
    const s = await lockSession(tx, t.sessionId);
    const [cur] = await tx.select().from(tokens).where(eq(tokens.id, tokenId));
    const st = cur.state;
    if (action === 'arrived' && st === 'BOOKED') await tx.update(tokens).set({ state: 'ARRIVED' }).where(eq(tokens.id, tokenId));
    if (action === 'missed' && ['BOOKED', 'ARRIVED', 'SERVING'].includes(st)) {
      notes.push(await markNotThere(tx, cur));
      if (st === 'SERVING') await tx.update(sessions).set({ servingNumber: 0 }).where(eq(sessions.id, s.id));
    }
    if (action === 'restore' && st === 'MISSED') await tx.update(tokens).set({ state: 'ARRIVED', queuePos: await endOfLine(tx, t.sessionId) }).where(eq(tokens.id, tokenId));
    if (action === 'done' && st === 'SERVING') {
      await tx.update(tokens).set({ state: 'DONE', doneAt: new Date() }).where(eq(tokens.id, tokenId));
      await tx.update(sessions).set({ servingNumber: 0 }).where(eq(sessions.id, s.id));
    }
    if (action === 'call' && ['BOOKED', 'ARRIVED', 'MISSED'].includes(st)) {
      if (s.status === 'ENDED' || s.status === 'CANCELLED') throw conflict('session_over', 'This sitting has ended. Turn it back on to call patients.');
      await tx.update(tokens).set({ state: 'DONE', doneAt: new Date() }).where(and(eq(tokens.sessionId, t.sessionId), eq(tokens.state, 'SERVING')));
      await tx.update(tokens).set({ state: 'SERVING', servedAt: new Date() }).where(eq(tokens.id, tokenId));
      const ds: DoctorStatus = s.doctorStatus === 'ON_TIME' || s.doctorStatus === 'LATE' ? 'ARRIVED' : s.doctorStatus;
      await tx.update(sessions).set({ servingNumber: t.number!, doctorStatus: ds, arrivedAt: s.arrivedAt ?? new Date() }).where(eq(sessions.id, s.id));
    }
  });
  await sendNotes(notes);
  await broadcastSession(t.sessionId);
  await checkAheadAlerts(t.sessionId);
  const [after] = await db.select().from(tokens).where(eq(tokens.id, tokenId));
  return after;
}

export async function setDoctorStatus(chamberId: string, sessionId: string, status: DoctorStatus, lateMinutes = 0) {
  const s = await agentSession(chamberId, sessionId);
  if (status === 'ENDED') return endSitting(chamberId, sessionId);
  const patch: Partial<typeof sessions.$inferInsert> = { doctorStatus: status, lateMinutes: status === 'LATE' ? lateMinutes : 0 };
  if (status === 'ARRIVED' && !s.arrivedAt) patch.arrivedAt = new Date();
  if (status === 'NOT_COMING') patch.status = 'CANCELLED';
  await db.update(sessions).set(patch).where(eq(sessions.id, sessionId));
  const { doctor, chamber } = await sessionWithRefs(sessionId);
  const waiting = await db.select().from(tokens).where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, ['BOOKED', 'ARRIVED']), eq(tokens.source, 'ONLINE'), isNotNull(tokens.userId)));
  for (const t of waiting) {
    if (status === 'NOT_COMING') {
      await db.update(tokens).set({ absentChoice: 'pending' }).where(eq(tokens.id, t.id));
      await notifyUser(t.userId!, 'not_coming', `${doctor.name} can't come today`, 'Pick another sitting in the app. Moving is free.', { tokenId: t.id });
    } else if (status === 'ARRIVED' && s.doctorStatus !== 'ARRIVED') {
      await notifyUser(t.userId!, 'arrived', 'Doctor has arrived', `${chamber.name}, serial ${t.number}`, { tokenId: t.id });
    } else if (status === 'LATE') {
      await notifyUser(t.userId!, 'late', `Doctor running ${lateMinutes} min late`, `${chamber.name}, serial ${t.number}`, { tokenId: t.id });
    } else if (status === 'BREAK') {
      await notifyUser(t.userId!, 'late', 'Doctor is on a short break', `${chamber.name}, serial ${t.number}. Your place in line is kept.`, { tokenId: t.id });
    }
  }
  await broadcastSession(sessionId);
  return { ok: true };
}

/**
 * The counter ends the sitting.
 * - The patient with the doctor is done.
 * - Online patients who were never called keep their serial and can move it to another day for free.
 * - Patients who were called and not there lose the serial (terms: missed serials are not moved).
 * - Walk-ins still waiting are marked not seen.
 * Turning the sitting back on undoes this for anyone who has not moved yet.
 */
export async function endSitting(chamberId: string, sessionId: string) {
  const s = await agentSession(chamberId, sessionId);
  if (s.status === 'ENDED') return { ok: true };
  const { doctor, chamber, session } = await sessionWithRefs(sessionId);
  const list = await db.select().from(tokens).where(and(eq(tokens.sessionId, sessionId), isNotNull(tokens.number)));
  await db.transaction(async (tx) => {
    await lockSession(tx, sessionId);
    await tx.update(sessions).set({ status: 'ENDED', doctorStatus: 'ENDED', lateMinutes: 0, servingNumber: 0 }).where(eq(sessions.id, sessionId));
    await tx.update(tokens).set({ state: 'DONE', doneAt: new Date() }).where(and(eq(tokens.sessionId, sessionId), eq(tokens.state, 'SERVING')));
    await tx.update(tokens).set({ state: 'NO_SHOW' }).where(and(eq(tokens.sessionId, sessionId), eq(tokens.state, 'MISSED')));
    await tx.update(tokens).set({ absentChoice: 'pending' }).where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, ['BOOKED', 'ARRIVED']), eq(tokens.source, 'ONLINE')));
    await tx.update(tokens).set({ state: 'NO_SHOW' }).where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, ['BOOKED', 'ARRIVED']), eq(tokens.source, 'WALKIN')));
  });
  for (const t of list) {
    if (!t.userId) continue;
    if (t.state === 'BOOKED' || t.state === 'ARRIVED') {
      await notifyUser(t.userId, 'ended', `${doctor.name}'s sitting ended before your turn`, `Serial ${t.number}, ${chamber.name}, ${prettyDate(session.date)}. Move it to another day in the app, free of charge.`, { tokenId: t.id });
    } else if (t.state === 'MISSED') {
      await notifyUser(t.userId, 'missed', `Serial ${t.number} was missed`, 'You were called and were not there, so this serial has ended. As per our terms, missed serials cannot be moved or refunded.', { tokenId: t.id });
    }
  }
  await broadcastSession(sessionId);
  return { ok: true };
}

/** Turn an ended sitting back on (ended by mistake, or the doctor stays longer). */
export async function reopenSitting(chamberId: string, sessionId: string) {
  const s = await agentSession(chamberId, sessionId);
  if (s.status !== 'ENDED') return { ok: true };
  const waiting = await db.select().from(tokens).where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, ['BOOKED', 'ARRIVED']), eq(tokens.absentChoice, 'pending')));
  await db.transaction(async (tx) => {
    await lockSession(tx, sessionId);
    await tx.update(sessions).set({ status: 'OPEN', doctorStatus: 'ARRIVED' }).where(eq(sessions.id, sessionId));
    await tx.update(tokens).set({ absentChoice: null }).where(and(eq(tokens.sessionId, sessionId), eq(tokens.absentChoice, 'pending')));
    // Not seen at the end: walk-ins back in line, missed patients back to missed.
    await tx.update(tokens).set({ state: 'ARRIVED' }).where(and(eq(tokens.sessionId, sessionId), eq(tokens.state, 'NO_SHOW'), eq(tokens.missCount, 0)));
    await tx.update(tokens).set({ state: 'MISSED' }).where(and(eq(tokens.sessionId, sessionId), eq(tokens.state, 'NO_SHOW'), gt(tokens.missCount, 0)));
  });
  const { chamber } = await sessionWithRefs(sessionId);
  for (const t of waiting) if (t.userId) await notifyUser(t.userId, 'arrived', 'The sitting is running again', `Serial ${t.number}, ${chamber.name}. Your place in line is kept.`, { tokenId: t.id });
  await broadcastSession(sessionId);
  return { ok: true };
}

export async function closeBooking(chamberId: string, sessionId: string) {
  const s = await agentSession(chamberId, sessionId);
  if (s.status === 'OPEN') await db.update(sessions).set({ status: 'CLOSED' }).where(eq(sessions.id, sessionId));
  await broadcastSession(sessionId);
}

/** Undo a manual close, while the sitting has not ended. */
export async function reopenBooking(chamberId: string, sessionId: string) {
  const s = await agentSession(chamberId, sessionId);
  if (s.status === 'CLOSED') await db.update(sessions).set({ status: 'OPEN' }).where(eq(sessions.id, sessionId));
  await broadcastSession(sessionId);
}
