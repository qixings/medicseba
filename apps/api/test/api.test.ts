import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool, schema } from '../src/db.js';
import { buildApp } from '../src/server.js';
import { seed } from '../src/scripts/seed.js';
import { ensureSessions } from '../src/sessions.js';
import { releaseExpiredHolds } from '../src/booking.js';
import { addDays, istDate } from '../src/time.js';

let app: Awaited<ReturnType<typeof buildApp>>;
const call = async (method: string, url: string, body?: unknown, token?: string) => {
  const r = await app.inject({ method: method as 'GET', url: `/v1${url}`, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.json() };
};

async function login(phone: string, name: string) {
  const req = await call('POST', '/auth/otp/request', { phone });
  assert.equal(req.status, 200, JSON.stringify(req.body));
  const v = await call('POST', '/auth/otp/verify', { phone, code: req.body.devCode });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  await call('PATCH', '/me', { name, age: 32, gender: 'MALE' }, v.body.token);
  const members = await call('GET', '/me/members', undefined, v.body.token);
  return { token: v.body.token as string, memberId: members.body[0].id as string };
}

async function book(token: string, sessionId: string, memberId: string) {
  const h = await call('POST', '/bookings/hold', { sessionId, memberId }, token);
  if (h.status !== 200) return h;
  return call('POST', '/bookings/confirm', { orderId: h.body.order.orderId, paymentId: 'pay_test', signature: 'mock_ok' }, token);
}

/** A bookable session of the given doctor, a few days out so the 2-hour rules don't interfere. */
async function sessionsOf(doctorName: string) {
  const [d] = await db.select().from(schema.doctors).where(eq(schema.doctors.name, doctorName));
  return db.select().from(schema.sessions).where(eq(schema.sessions.doctorId, d.id)).orderBy(schema.sessions.date);
}

let agentToken = '';

before(async () => {
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  await migrate(db, { migrationsFolder: './drizzle' });
  await seed();
  await ensureSessions(istDate(), 14);
  app = await buildApp();
  const a = await call('POST', '/agent/login', { username: 'citymedicos', password: 'demo1234' });
  assert.equal(a.status, 200);
  agentToken = a.body.token;
});
after(async () => { await app.close(); await pool.end(); });

test('OTP login rejects a wrong code and accepts the right one', async () => {
  const r = await call('POST', '/auth/otp/request', { phone: '98765 00001' });
  const wrong = r.body.devCode === '000000' ? '111111' : '000000';
  const bad = await call('POST', '/auth/otp/verify', { phone: '9876500001', code: wrong });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'otp_wrong');
  const ok = await call('POST', '/auth/otp/verify', { phone: '+91 98765 00001', code: r.body.devCode });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isNew, true);
  const bad2 = await call('POST', '/auth/otp/request', { phone: '12345' });
  assert.equal(bad2.body.error, 'bad_phone');
});

test('catalog: home, doctors by specialty, doctor calendar, chambers', async () => {
  const home = await call('GET', '/home');
  assert.equal(home.status, 200);
  assert.ok(home.body.chambers.length >= 4);
  const docs = await call('GET', '/doctors?specialty=general');
  assert.ok(docs.body.doctors.every((d: { specialty: { slug: string } }) => d.specialty.slug === 'general'));
  const amit = docs.body.doctors.find((d: { name: string }) => d.name === 'Dr. Amit Nath');
  const detail = await call('GET', `/doctors/${amit.id}`);
  assert.equal(detail.body.chambers.length, 2);
  const month = istDate().slice(0, 7);
  const cal = await call('GET', `/doctors/${amit.id}/calendar?month=${month}`);
  assert.ok(cal.body.sessions.length > 0);
  const pharm = await call('GET', '/chambers?filter=pharmacy');
  assert.ok(pharm.body.every((c: { kind: string }) => c.kind === 'PHARMACY'));
});

test('booking: hold, pay, token number, live queue, agent moves the queue', async () => {
  const s = (await sessionsOf('Dr. Riya Chakraborty')).find((x) => x.date >= addDays(istDate(), 2))!;
  const u1 = await login('9000000001', 'Rahul Das');
  const u2 = await login('9000000002', 'Mamata Das');

  const b1 = await book(u1.token, s.id, u1.memberId);
  assert.equal(b1.status, 200, JSON.stringify(b1.body));
  assert.equal(b1.body.token.number, 1);
  assert.equal(b1.body.token.state, 'BOOKED');

  const walk = await call('POST', `/agent/sessions/${s.id}/walkin`, { name: 'Walk-in Patient' }, agentToken);
  assert.equal(walk.body.number, 2);

  const b2 = await book(u2.token, s.id, u2.memberId);
  assert.equal(b2.body.token.number, 3);
  assert.equal(b2.body.ahead, 2);

  // Same person cannot book twice for one session.
  const dup = await call('POST', '/bookings/hold', { sessionId: s.id, memberId: u1.memberId }, u1.token);
  assert.equal(dup.body.error, 'already_booked');

  // Wrong payment signature is refused.
  const m = await call('POST', '/me/members', { name: 'Ankit Das', age: 9, gender: 'MALE' }, u1.token);
  const h = await call('POST', '/bookings/hold', { sessionId: s.id, memberId: m.body.id }, u1.token);
  const badPay = await call('POST', '/bookings/confirm', { orderId: h.body.order.orderId, paymentId: 'x', signature: 'nope' }, u1.token);
  assert.equal(badPay.body.error, 'payment_failed');

  await call('POST', `/agent/sessions/${s.id}/next`, undefined, agentToken); // serving 1
  let live = await call('GET', `/bookings/${b2.body.token.id}/live`, undefined, u2.token);
  assert.equal(live.body.session.servingNumber, 1);
  assert.equal(live.body.ahead, 1);
  assert.equal(live.body.session.doctorStatus, 'ARRIVED');
  await call('POST', `/agent/sessions/${s.id}/next`, undefined, agentToken); // serving 2
  live = await call('GET', `/bookings/${b2.body.token.id}/live`, undefined, u2.token);
  assert.equal(live.body.ahead, 0);

  const mine = await call('GET', '/bookings?scope=upcoming', undefined, u2.token);
  assert.equal(mine.body.length, 1);
  assert.equal(mine.body[0].number, 3);

  // Agent of another chamber cannot touch this session.
  const other = await call('POST', '/agent/login', { username: 'lifeline', password: 'demo1234' });
  const denied = await call('POST', `/agent/sessions/${s.id}/next`, undefined, other.body.token);
  assert.equal(denied.status, 403);
});

test('a full session refuses more bookings, even when they race', async () => {
  const s = (await sessionsOf('Dr. Sujit Roy')).find((x) => x.date >= addDays(istDate(), 3))!;
  await db.update(schema.sessions).set({ onlineLimit: 3, tokenLimit: 5 }).where(eq(schema.sessions.id, s.id));
  const users = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => login(`91000000${10 + i}`, `Patient ${i}`)));
  const results = await Promise.all(users.map((u) => call('POST', '/bookings/hold', { sessionId: s.id, memberId: u.memberId }, u.token)));
  const ok = results.filter((r) => r.status === 200).length;
  assert.equal(ok, 3, 'only the online share can be held');
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.error === 'session_full'));
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, s.id));
  assert.equal(row.onlineTaken, 3);
});

test('unpaid holds expire and free the place', async () => {
  const s = (await sessionsOf('Dr. Kamal Sinha')).find((x) => x.date >= addDays(istDate(), 2))!;
  const u = await login('9200000001', 'Hold Test');
  const h = await call('POST', '/bookings/hold', { sessionId: s.id, memberId: u.memberId }, u.token);
  assert.equal(h.status, 200);
  await db.update(schema.tokens).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.tokens.id, h.body.tokenId));
  assert.equal(await releaseExpiredHolds(), 1);
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, s.id));
  assert.equal(row.onlineTaken, 0);
  // Paying late still works while there is room.
  const late = await call('POST', '/bookings/confirm', { orderId: h.body.order.orderId, paymentId: 'pay_late', signature: 'mock_ok' }, u.token);
  assert.equal(late.status, 200);
  assert.equal(late.body.token.state, 'BOOKED');
});

test('reschedule once, then refused', async () => {
  const list = (await sessionsOf('Dr. Priya Debnath')).filter((x) => x.date >= addDays(istDate(), 2));
  const u = await login('9300000001', 'Move Test');
  const b = await book(u.token, list[0].id, u.memberId);
  const moved = await call('POST', `/bookings/${b.body.token.id}/reschedule`, { sessionId: list[1].id }, u.token);
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.session.id, list[1].id);
  const again = await call('POST', `/bookings/${moved.body.token.id}/reschedule`, { sessionId: list[2].id }, u.token);
  assert.equal(again.body.error, 'reschedule_used');
});

test('cancel gives no refund and frees the place', async () => {
  const s = (await sessionsOf('Dr. Priya Debnath')).filter((x) => x.date >= addDays(istDate(), 2))[3];
  const u = await login('9300000002', 'Cancel Test');
  const b = await book(u.token, s.id, u.memberId);
  const c = await call('POST', `/bookings/${b.body.token.id}/cancel`, undefined, u.token);
  assert.equal(c.body.refunded, false);
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, s.id));
  assert.equal(row.onlineTaken, 0);
});

test('doctor not coming: patient moves for free, no refunds', async () => {
  const list = (await sessionsOf('Dr. Mitali Saha')).filter((x) => x.date >= addDays(istDate(), 1));
  const [s, next] = list;
  const u1 = await login('9400000001', 'Refund Me');
  const u2 = await login('9400000002', 'Move Me');
  const b1 = await book(u1.token, s.id, u1.memberId);
  const b2 = await book(u2.token, s.id, u2.memberId);
  const st = await call('POST', `/agent/sessions/${s.id}/status`, { status: 'NOT_COMING' }, agentToken);
  assert.equal(st.status, 200);
  const notes = await call('GET', '/me/notifications', undefined, u1.token);
  assert.ok(notes.body.some((n: { kind: string }) => n.kind === 'not_coming'));

  // No-refund policy: a refund is not an option for patients.
  const r = await call('POST', `/bookings/${b1.body.token.id}/absent-choice`, { choice: 'refund' }, u1.token);
  assert.equal(r.status, 400);
  const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.tokenId, b1.body.token.id));
  assert.equal(pay.status, 'PAID');

  const mv = await call('POST', `/bookings/${b2.body.token.id}/absent-choice`, { choice: 'move', sessionId: next.id }, u2.token);
  assert.equal(mv.status, 200, JSON.stringify(mv.body));
  assert.equal(mv.body.session.id, next.id);
  assert.equal(mv.body.token.rescheduleUsed, false, 'a doctor-caused move does not use up the free reschedule');

  const newHold = await call('POST', '/bookings/hold', { sessionId: s.id, memberId: u1.memberId }, u1.token);
  assert.equal(newHold.body.error, 'session_closed');
});

test('agent counter: board, walk-in retry, safe next, missed and recall, close and reopen', async () => {
  const s = (await sessionsOf('Dr. Amit Nath')).find((x) => x.date >= addDays(istDate(), 2))!;
  // Usernames are not case sensitive.
  assert.equal((await call('POST', '/agent/login', { username: 'CityMedicos', password: 'demo1234' })).status, 200);
  // Amit sits at two chambers; use the agent of this sitting's chamber.
  const [ch] = await db.select().from(schema.chambers).where(eq(schema.chambers.id, s.chamberId));
  const [acc] = await db.select().from(schema.agentAccounts).where(eq(schema.agentAccounts.chamberId, ch.id));
  const a = (await call('POST', '/agent/login', { username: acc.username, password: 'demo1234' })).body.token as string;

  const u = await login('9500000001', 'Online Patient');
  const b = await book(u.token, s.id, u.memberId);
  assert.equal(b.body.token.number, 1);

  const w1 = await call('POST', `/agent/sessions/${s.id}/walkin`, { name: 'Counter One', age: 40, clientRef: 'dev1-abc' }, a);
  const again = await call('POST', `/agent/sessions/${s.id}/walkin`, { name: 'Counter One', age: 40, clientRef: 'dev1-abc' }, a);
  assert.equal(w1.body.number, 2);
  assert.equal(again.body.id, w1.body.id, 'a retried walk-in is not added twice');
  assert.equal(w1.body.state, 'ARRIVED');

  let board = await call('GET', `/agent/sessions/${s.id}/board`, undefined, a);
  assert.equal(board.body.tokens.length, 2);
  assert.equal(board.body.session.counterTaken, 1);
  assert.ok(board.body.tokens[0].phone === null || board.body.tokens[0].phone.includes('xxxxxx'), 'online phone numbers are masked');

  const n1 = await call('POST', `/agent/sessions/${s.id}/next`, { expect: 0 }, a);
  assert.equal(n1.body.serving.number, 1);
  // Same press replayed after being offline: no skip.
  const replay = await call('POST', `/agent/sessions/${s.id}/next`, { expect: 0 }, a);
  assert.equal(replay.body.serving, null);
  board = await call('GET', `/agent/sessions/${s.id}/board`, undefined, a);
  assert.equal(board.body.session.servingNumber, 1);

  // Token 1 did not come in: missed, call 2.
  const n2 = await call('POST', `/agent/sessions/${s.id}/next`, { expect: 1, current: 'MISSED' }, a);
  assert.equal(n2.body.serving.number, 2);
  board = await call('GET', `/agent/sessions/${s.id}/board`, undefined, a);
  assert.equal(board.body.tokens[0].state, 'MISSED');

  // Patient 1 comes back: call them now; serving number does not go backwards.
  const back = await call('POST', `/agent/tokens/${board.body.tokens[0].id}/call`, {}, a);
  assert.equal(back.body.state, 'SERVING');
  board = await call('GET', `/agent/sessions/${s.id}/board`, undefined, a);
  assert.equal(board.body.session.servingNumber, 2);
  assert.equal(board.body.tokens[1].state, 'DONE');

  await call('POST', `/agent/sessions/${s.id}/close`, {}, a);
  const late = await login('9500000002', 'Late Comer');
  const closed = await call('POST', '/bookings/hold', { sessionId: s.id, memberId: late.memberId }, late.token);
  assert.equal(closed.status, 409);
  await call('POST', `/agent/sessions/${s.id}/reopen`, {}, a);
  board = await call('GET', `/agent/sessions/${s.id}/board`, undefined, a);
  assert.equal(board.body.session.status, 'OPEN');

  const list = await call('GET', `/agent/sessions?date=${s.date}`, undefined, a);
  assert.ok(list.body.sessions.some((x: { id: string }) => x.id === s.id));
});


test('admin: roles, doctor and schedule, session limits, refund, settlement', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash('secret123', 4);
  await db.insert(schema.adminUsers).values([
    { username: 'owner1', name: 'Owner', role: 'OWNER', passwordHash: hash },
    { username: 'support1', name: 'Support', role: 'SUPPORT', passwordHash: hash },
  ]).onConflictDoNothing();
  const own = (await call('POST', '/admin/login', { username: 'owner1', password: 'secret123' })).body.token as string;
  const sup = (await call('POST', '/admin/login', { username: 'support1', password: 'secret123' })).body.token as string;
  assert.equal((await call('POST', '/admin/login', { username: 'owner1', password: 'nope' })).status, 401);

  // Support can look but not change.
  assert.equal((await call('GET', '/admin/dashboard', undefined, sup)).status, 200);
  const spec = (await call('GET', '/admin/specialties', undefined, sup)).body[0];
  assert.equal((await call('POST', '/admin/doctors', { name: 'Dr. Test', degrees: 'MBBS', specialtyId: spec.id, experienceYears: 3, consultFee: 300, languages: ['Bengali'], bookingWindowDays: 7 }, sup)).status, 403);
  // Patients and counters cannot use admin at all.
  assert.equal((await call('GET', '/admin/dashboard', undefined, agentToken)).status, 401);

  const doc = await call('POST', '/admin/doctors', { name: 'Dr. Test Sen', degrees: 'MBBS', specialtyId: spec.id, experienceYears: 3, consultFee: 300, languages: ['Bengali'], bookingWindowDays: 7 }, own);
  assert.equal(doc.status, 200, JSON.stringify(doc.body));
  const chamber = (await call('GET', '/admin/chambers', undefined, own)).body[0];
  const sc = await call('POST', `/admin/doctors/${doc.body.id}/schedules`, { chamberId: chamber.id, weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', tokenLimit: 10, onlineShare: 50 }, own);
  assert.equal(sc.status, 200, JSON.stringify(sc.body));
  const day = addDays(istDate(), 2);
  let list = (await call('GET', `/admin/sessions?date=${day}&chamberId=${chamber.id}`, undefined, own)).body as { id: string; doctor: { id: string }; tokenLimit: number; onlineLimit: number }[];
  let mine = list.find((x) => x.doctor.id === doc.body.id)!;
  assert.equal(mine.tokenLimit, 10);
  assert.equal(mine.onlineLimit, 5);

  // A patient books, then limits cannot go below that, and the schedule change keeps the booking.
  const u = await login('9600000001', 'Admin Test');
  const b = await book(u.token, mine.id, u.memberId);
  assert.equal(b.status, 200);
  assert.equal((await call('PATCH', `/admin/sessions/${mine.id}`, { onlineLimit: 0 }, own)).status, 409);
  assert.equal((await call('PATCH', `/admin/sessions/${mine.id}`, { tokenLimit: 20, onlineLimit: 15 }, own)).body.onlineLimit, 15);
  const off = await call('PATCH', `/admin/schedules/${sc.body.schedule.id}`, { weekdays: [weekdayOf(addDays(day, 1))] }, own);
  assert.ok(off.body.result.kept >= 1, 'a booked day is not cancelled');
  list = (await call('GET', `/admin/sessions?date=${day}&chamberId=${chamber.id}`, undefined, own)).body;
  mine = list.find((x) => x.doctor.id === doc.body.id)!;
  assert.ok(mine, 'booked sitting still there');

  // Search, move (the normal fix), and the owner-only refund for payment errors.
  let found = await call('GET', '/admin/bookings?q=9600000001', undefined, sup);
  assert.equal(found.body.length, 1);
  const targets = await call('GET', `/admin/doctors/${doc.body.id}/upcoming`, undefined, own);
  const target = targets.body.find((x: { id: string; left: number }) => x.id !== mine.id && x.left > 0);
  assert.equal((await call('POST', `/admin/bookings/${found.body[0].id}/move`, { sessionId: target.id, reason: 'x support' }, sup)).status, 403);
  const mv = await call('POST', `/admin/bookings/${found.body[0].id}/move`, { sessionId: target.id, reason: 'Doctor away' }, own);
  assert.equal(mv.status, 200, JSON.stringify(mv.body));
  found = await call('GET', '/admin/bookings?q=9600000001', undefined, sup);
  const movedRow = found.body.find((x: { state: string }) => x.state === 'BOOKED');
  assert.ok(movedRow, 'moved serial is booked');
  assert.equal((await call('POST', `/admin/bookings/${movedRow.id}/refund`, { reason: 'test' }, sup)).status, 403);
  const rf = await call('POST', `/admin/bookings/${movedRow.id}/refund`, { reason: 'Charged twice by the bank' }, own);
  assert.equal(rf.status, 200, JSON.stringify(rf.body));
  const [sAfter] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, target.id));
  assert.equal(sAfter.onlineTaken, 0, 'refund frees the place');

  // Settlement for a past day with one paid booking.
  const past = addDays(istDate(), -1);
  const ses = (await sessionsOf('Dr. Riya Chakraborty')).find((x) => x.date >= addDays(istDate(), 1))!;
  const u2 = await login('9600000002', 'Settle Test');
  const b2 = await book(u2.token, ses.id, u2.memberId);
  assert.equal(b2.status, 200);
  await db.update(schema.sessions).set({ date: past }).where(eq(schema.sessions.id, ses.id));
  const gen = await call('POST', '/admin/settlements/generate', { date: past }, own);
  assert.equal(gen.status, 200);
  const st = await call('GET', `/admin/settlements?date=${past}`, undefined, own);
  const row = st.body.saved.find((x: { chamberId: string }) => x.chamberId === ses.chamberId);
  assert.ok(row.bookings >= 1);
  assert.equal(row.amount, row.bookings * 55, 'chamber gets ₹55 per paid booking');
  assert.equal(row.platformFees, row.bookings * 10, 'platform keeps ₹10 per paid booking');
  const paid = await call('POST', `/admin/settlements/${row.id}/paid`, { reference: 'UTR123456' }, own);
  assert.equal(paid.body.status, 'PAID');
  assert.equal((await call('POST', `/admin/settlements/${row.id}/paid`, { reference: 'again' }, own)).status, 409);
  assert.equal((await call('POST', '/admin/settlements/generate', { date: istDate() }, own)).status, 409, 'today cannot be settled yet');
});

function weekdayOf(date: string) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }

test('broadcasts reach patients and counters; patient profile; settings', async () => {
  const own = (await call('POST', '/admin/login', { username: 'owner1', password: 'secret123' })).body.token as string;
  const sup = (await call('POST', '/admin/login', { username: 'support1', password: 'secret123' })).body.token as string;
  const u = await login('9700000001', 'Broadcast Patient');
  const pv = await call('POST', '/admin/broadcasts/preview', { kind: 'patient', id: (await call('GET', '/me', undefined, u.token)).body.id }, sup);
  assert.equal(pv.body.patients, 1);
  const me = (await call('GET', '/me', undefined, u.token)).body;
  assert.equal((await call('POST', '/admin/broadcasts', { audience: { kind: 'patient', id: me.id }, label: 'One', title: 'Hello', body: 'Test message' }, sup)).status, 403);
  const sent = await call('POST', '/admin/broadcasts', { audience: { kind: 'patient', id: me.id }, label: 'One patient', title: 'Clinic closed Sunday', body: 'City Medicos is closed this Sunday.' }, own);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  await new Promise((r) => setTimeout(r, 300));
  const notes = await call('GET', '/me/notifications', undefined, u.token);
  assert.ok(notes.body.some((n: { title: string }) => n.title === 'Clinic closed Sunday'));

  await call('POST', '/admin/broadcasts', { audience: { kind: 'all_counters' }, label: 'All counters', title: 'New rule', body: 'Ask patients to show the serial in the app.' }, own);
  await new Promise((r) => setTimeout(r, 300));
  const msgs = await call('GET', '/agent/messages', undefined, agentToken);
  assert.ok(msgs.body.some((m: { title: string; readAt: string | null }) => m.title === 'New rule' && !m.readAt));
  await call('POST', '/agent/messages/read', {}, agentToken);
  assert.ok((await call('GET', '/agent/messages', undefined, agentToken)).body.every((m: { readAt: string | null }) => m.readAt));

  const prof = await call('GET', `/admin/patients/${me.id}`, undefined, sup);
  assert.equal(prof.body.phone, '+919700000001');
  assert.equal(prof.body.family.length, 1);
  assert.ok(prof.body.notifications.length >= 1);

  assert.equal((await call('GET', '/admin/settings/notifications', undefined, sup)).status, 403);
  const st = await call('GET', '/admin/settings/notifications', undefined, own);
  assert.equal(st.body.status.whatsapp, false);
  const saved = await call('PUT', '/admin/settings/notifications', { whatsapp: { enabled: true, template: 'medicseba_update', events: { booked: true, late: false } } }, own);
  assert.equal(saved.body.whatsapp.enabled, true);
  assert.equal(saved.body.whatsapp.events.late, false);
  const test = await call('POST', '/admin/settings/notifications/test', { phone: '9876543210' }, own);
  assert.equal(test.status, 502, 'test send says WhatsApp is not connected');
});

test('logins renew themselves after a week', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const { env } = await import('../src/env.js');
  const u = await login('9800000001', 'Old Login');
  const me = (await call('GET', '/me', undefined, u.token)).body;
  assert.equal(me.token, undefined, 'a fresh login is not renewed');
  const old = jwt.sign({ sub: me.id, role: 'patient', iat: Math.floor(Date.now() / 1000) - 8 * 86_400 }, env.jwtSecret, { expiresIn: '90d' });
  const r = (await call('GET', '/me', undefined, old)).body;
  assert.ok(r.token, 'an 8-day-old login gets a new one');
  assert.equal((await call('GET', '/me', undefined, r.token)).status, 200);
});
