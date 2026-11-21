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
      throw conflict(full ? 'session_full' : 'session_closed', full ? 'This session is full' : 'Booking is closed for this session');
    }
    const mine = await tx.select().from(tokens).where(and(eq(tokens.sessionId, sessionId), eq(tokens.userId, userId), inArray(tokens.state, ACTIVE)));
    if (mine.some((t) => t.memberId === memberId)) throw conflict('already_booked', `${member.name} already has a token for this session`);
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
    const [token] = await tx.update(tokens).set({ state: 'BOOKED', number: s.nextNumber, holdExpiresAt: null }).where(eq(tokens.id, t.id)).returning();
    return { token, lateFail: false };
  });

  if (result.lateFail) {
    await refundToken(result.token.id);
    throw conflict('session_full', `The session filled up while you were paying. Your ₹${pay.amount} is being refunded`);
  }
  const t = result.token;
  const { session: s, doctor, chamber } = await sessionWithRefs(t.sessionId);
  if (t.userId) await notifyUser(t.userId, 'booked', `Token ${t.number} booked`, `${doctor.name}, ${chamber.name}, ${prettyDate(s.date)}, ${prettyTime(s.startTime)}`, { tokenId: t.id });
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
async function moveToken(tokenId: string, targetSessionId: string, opts: { countAsReschedule: boolean }) {
  const [t0] = await db.select().from(tokens).where(eq(tokens.id, tokenId));
  if (t0.sessionId === targetSessionId) throw badRequest('same_session', 'Pick a different session');
  const [a, b] = [t0.sessionId, targetSessionId].sort();
  const moved = await db.transaction(async (tx) => {
    const sa = await lockSession(tx, a);
    const sb = await lockSession(tx, b);
    const from = sa.id === t0.sessionId ? sa : sb;
    const to = sa.id === targetSessionId ? sa : sb;
    if (to.doctorId !== from.doctorId) throw badRequest('other_doctor', 'You can only move to a session of the same doctor');
    if (!isBookable(to, await windowFor(tx, to.doctorId))) throw conflict('session_full', 'That session is full or closed');
    const [t] = await tx.select().from(tokens).where(eq(tokens.id, tokenId));
    if (t.state !== 'BOOKED') throw conflict('not_movable', 'This booking can no longer be moved');
    await tx.update(tokens).set({ state: 'MOVED' }).where(eq(tokens.id, t.id));
    if (from.status !== 'CANCELLED') await tx.update(sessions).set({ onlineTaken: inc(sessions.onlineTaken, -1) }).where(eq(sessions.id, from.id));
    await tx.update(sessions).set({ onlineTaken: inc(sessions.onlineTaken), nextNumber: inc(sessions.nextNumber) }).where(eq(sessions.id, to.id));
    const [created] = await tx.insert(tokens).values({
      sessionId: to.id, number: to.nextNumber, source: 'ONLINE', state: 'BOOKED', userId: t.userId, memberId: t.memberId,
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
  if (t.state !== 'BOOKED') throw conflict('not_movable', 'Only booked tokens can be moved');
  if (t.rescheduleUsed) throw conflict('reschedule_used', 'This booking was already moved once');
  if (Date.now() > t.session.startsAt.getTime() - env.rescheduleCutoffMinutes * 60_000) {
    throw conflict('too_late', `Bookings can be moved up to ${env.rescheduleCutoffMinutes / 60} hours before the session`);
  }
  const moved = await moveToken(tokenId, targetSessionId, { countAsReschedule: true });
  await notifyUser(userId, 'moved', `Booking moved, token ${moved.number}`, 'Your booking was moved to a new session', { tokenId: moved.id });
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

/** After the doctor cancels: the patient picks a full refund or a free move. */
export async function absentChoice(userId: string, tokenId: string, choice: 'refund' | 'move', targetSessionId?: string) {
  const t = await ownedToken(userId, tokenId);
  if (t.session.doctorStatus !== 'NOT_COMING' || t.state !== 'BOOKED') throw conflict('no_choice', 'There is nothing to choose for this booking');
  if (choice === 'refund') {
    const r = await refundToken(t.id);
    await notifyUser(userId, 'refunded', `Refund of ₹${t.payment?.amount ?? 0} started`, 'It goes back to the UPI account or card you paid from', { tokenId: t.id });
    return r;
  }
  if (!targetSessionId) throw badRequest('pick_session', 'Pick the session to move to');
  const moved = await moveToken(t.id, targetSessionId, { countAsReschedule: false });
  await notifyUser(userId, 'moved', `Moved, token ${moved.number}`, 'Your booking was moved to the next session', { tokenId: moved.id });
  return moved;
}

/* ---------------- chamber agent actions ---------------- */

async function agentSession(chamberId: string, sessionId: string) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!s) throw notFound('Session');
  if (s.chamberId !== chamberId) throw forbidden();
  return s;
}

export async function addWalkIn(chamberId: string, sessionId: string, p: { name: string; age?: number; gender?: 'MALE' | 'FEMALE' | 'OTHER'; phone?: string; clientRef?: string }) {
  await agentSession(chamberId, sessionId);
  if (p.clientRef) {
    // Already added (the app retried after going offline): return the same token.
    const [dup] = await db.select().from(tokens).where(eq(tokens.clientRef, p.clientRef));
    if (dup) return dup;
  }
  const t = await db.transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (s.status === 'CANCELLED' || s.status === 'ENDED') throw conflict('session_closed', 'This sitting is over');
    if (s.onlineTaken + s.counterTaken >= s.tokenLimit) throw conflict('session_full', 'No tokens left in this sitting');
    await tx.update(sessions).set({ counterTaken: inc(sessions.counterTaken), nextNumber: inc(sessions.nextNumber) }).where(eq(sessions.id, s.id));
    const [row] = await tx.insert(tokens).values({
      sessionId, number: s.nextNumber, source: 'WALKIN', state: 'ARRIVED', patientName: p.name,
      patientAge: p.age, patientGender: p.gender, phone: p.phone, clientRef: p.clientRef,
    }).returning();
    return row;
  });
  await broadcastSession(sessionId);
  return t;
}

/**
 * Finish the current patient (done, or missed if they did not come in) and call the next one in token order.
 * `expect` is the serving number the agent saw. If the queue has already moved past it (a retry after being
 * offline, or two phones at one counter), nothing happens, so a patient is never skipped by accident.
 */
export async function callNext(chamberId: string, sessionId: string, opts: { expect?: number; current?: 'DONE' | 'MISSED' } = {}) {
  await agentSession(chamberId, sessionId);
  const next = await db.transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (opts.expect !== undefined && s.servingNumber !== opts.expect) return null;
    const finish = opts.current === 'MISSED' ? { state: 'MISSED' as const } : { state: 'DONE' as const, doneAt: new Date() };
    await tx.update(tokens).set(finish).where(and(eq(tokens.sessionId, sessionId), eq(tokens.state, 'SERVING')));
    const [n] = await tx.select().from(tokens)
      .where(and(eq(tokens.sessionId, sessionId), inArray(tokens.state, ['BOOKED', 'ARRIVED']), isNotNull(tokens.number), gt(tokens.number, s.servingNumber)))
      .orderBy(asc(tokens.number)).limit(1);
    if (!n) return null;
    await tx.update(tokens).set({ state: 'SERVING', servedAt: new Date() }).where(eq(tokens.id, n.id));
    const ds: DoctorStatus = s.doctorStatus === 'ON_TIME' || s.doctorStatus === 'LATE' ? 'ARRIVED' : s.doctorStatus;
    await tx.update(sessions).set({ servingNumber: n.number!, doctorStatus: ds, arrivedAt: s.arrivedAt ?? new Date() }).where(eq(sessions.id, s.id));
    return n;
  });
  await broadcastSession(sessionId);
  await checkAheadAlerts(sessionId);
  return next;
}

export type TokenAction = 'arrived' | 'missed' | 'done' | 'call' | 'restore';

/**
 * Counter actions on one token. All of them are safe to repeat.
 * - arrived: patient is at the chamber
 * - missed: called but not there; they can be called again later
 * - call: call this patient now (a missed patient who came back, or out of order)
 * - done: finished with the doctor
 * - restore: undo a missed mark, back into the waiting line
 */
export async function tokenAction(chamberId: string, tokenId: string, action: TokenAction) {
  const [t] = await db.select().from(tokens).where(eq(tokens.id, tokenId));
  if (!t || t.number === null) throw notFound('Token');
  await agentSession(chamberId, t.sessionId);
  await db.transaction(async (tx) => {
    const s = await lockSession(tx, t.sessionId);
    const [cur] = await tx.select().from(tokens).where(eq(tokens.id, tokenId));
    const st = cur.state;
    if (action === 'arrived' && st === 'BOOKED') await tx.update(tokens).set({ state: 'ARRIVED' }).where(eq(tokens.id, tokenId));
    if (action === 'missed' && ['BOOKED', 'ARRIVED', 'SERVING'].includes(st)) await tx.update(tokens).set({ state: 'MISSED' }).where(eq(tokens.id, tokenId));
    if (action === 'restore' && st === 'MISSED') await tx.update(tokens).set({ state: 'ARRIVED' }).where(eq(tokens.id, tokenId));
    if (action === 'done' && st === 'SERVING') await tx.update(tokens).set({ state: 'DONE', doneAt: new Date() }).where(eq(tokens.id, tokenId));
    if (action === 'call' && ['BOOKED', 'ARRIVED', 'MISSED'].includes(st)) {
      await tx.update(tokens).set({ state: 'DONE', doneAt: new Date() }).where(and(eq(tokens.sessionId, t.sessionId), eq(tokens.state, 'SERVING')));
      await tx.update(tokens).set({ state: 'SERVING', servedAt: new Date() }).where(eq(tokens.id, tokenId));
      // The serving number never goes backwards, so "patients ahead" stays right for everyone else.
      const ds: DoctorStatus = s.doctorStatus === 'ON_TIME' || s.doctorStatus === 'LATE' ? 'ARRIVED' : s.doctorStatus;
      await tx.update(sessions).set({ servingNumber: Math.max(s.servingNumber, t.number!), doctorStatus: ds, arrivedAt: s.arrivedAt ?? new Date() }).where(eq(sessions.id, s.id));
    }
  });
  await broadcastSession(t.sessionId);
  if (action === 'call') await checkAheadAlerts(t.sessionId);
  const [after] = await db.select().from(tokens).where(eq(tokens.id, tokenId));
  return after;
}

export async function setDoctorStatus(chamberId: string, sessionId: string, status: DoctorStatus, lateMinutes = 0) {
  const s = await agentSession(chamberId, sessionId);
  const patch: Partial<typeof sessions.$inferInsert> = { doctorStatus: status, lateMinutes: status === 'LATE' ? lateMinutes : 0 };
  if (status === 'ARRIVED' && !s.arrivedAt) patch.arrivedAt = new Date();
  if (status === 'NOT_COMING') patch.status = 'CANCELLED';
  if (status === 'ENDED') patch.status = 'ENDED';
  await db.update(sessions).set(patch).where(eq(sessions.id, sessionId));
  const { doctor, chamber } = await sessionWithRefs(sessionId);
  const waiting = await db.select().from(tokens).where(and(eq(tokens.sessionId, sessionId), eq(tokens.state, 'BOOKED'), eq(tokens.source, 'ONLINE'), isNotNull(tokens.userId)));
  for (const t of waiting) {
    if (status === 'NOT_COMING') {
      await db.update(tokens).set({ absentChoice: 'pending' }).where(eq(tokens.id, t.id));
      await notifyUser(t.userId!, 'not_coming', `${doctor.name} can't come today`, 'Choose a full refund or a move to the next session', { tokenId: t.id });
    } else if (status === 'ARRIVED' && s.doctorStatus !== 'ARRIVED') {
      await notifyUser(t.userId!, 'arrived', 'Doctor has arrived', `${chamber.name}, token ${t.number}`, { tokenId: t.id });
    } else if (status === 'LATE') {
      await notifyUser(t.userId!, 'late', `Doctor running ${lateMinutes} min late`, `${chamber.name}, token ${t.number}`, { tokenId: t.id });
    }
  }
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
