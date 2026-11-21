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

test('doctor not coming: patient picks refund or move', async () => {
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

  const r = await call('POST', `/bookings/${b1.body.token.id}/absent-choice`, { choice: 'refund' }, u1.token);
  assert.equal(r.body.token.state, 'REFUNDED');
  const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.tokenId, b1.body.token.id));
  assert.equal(pay.status, 'REFUNDED');

  const mv = await call('POST', `/bookings/${b2.body.token.id}/absent-choice`, { choice: 'move', sessionId: next.id }, u2.token);
  assert.equal(mv.status, 200, JSON.stringify(mv.body));
  assert.equal(mv.body.session.id, next.id);
  assert.equal(mv.body.token.rescheduleUsed, false, 'a doctor-caused move does not use up the free reschedule');

  const newHold = await call('POST', '/bookings/hold', { sessionId: s.id, memberId: u1.memberId }, u1.token);
  assert.equal(newHold.body.error, 'session_closed');
});
