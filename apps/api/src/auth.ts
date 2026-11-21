import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from './db.js';
import { env } from './env.js';
import { badRequest, forbidden, unauthorized } from './errors.js';
import { sendOtpSms } from './notify.js';

const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const { otpCodes, users, adminUsers, agentAccounts } = schema;

const hash = (s: string) => crypto.createHash('sha256').update(`${env.jwtSecret}:${s}`).digest('hex');

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) throw badRequest('bad_phone', 'Enter a valid 10-digit Indian mobile number');
  return `+91${ten}`;
}

export async function requestOtp(rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  const [{ n }] = await db.select({ n: count() }).from(otpCodes).where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, new Date(Date.now() - 10 * 60_000))));
  if (n >= 5) throw badRequest('otp_limit', 'Too many codes requested. Try again in 10 minutes');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.insert(otpCodes).values({ phone, codeHash: hash(code), expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000) });
  await sendOtpSms(phone, code);
  return { phone, devCode: env.smsProvider === 'log' && (env.nodeEnv !== 'production' || env.demoMode) ? code : undefined };
}

export async function verifyOtp(rawPhone: string, code: string) {
  const phone = normalizePhone(rawPhone);
  const [otp] = await db.select().from(otpCodes).where(and(eq(otpCodes.phone, phone), isNull(otpCodes.usedAt))).orderBy(desc(otpCodes.createdAt)).limit(1);
  if (!otp || otp.expiresAt < new Date()) throw badRequest('otp_expired', 'Code expired. Request a new one');
  if (otp.attempts >= MAX_ATTEMPTS) throw badRequest('otp_locked', 'Too many wrong tries. Request a new code');
  if (otp.codeHash !== hash(code.trim())) {
    await db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, otp.id));
    throw badRequest('otp_wrong', 'Wrong code. Check the SMS and try again');
  }
  await db.update(otpCodes).set({ usedAt: new Date() }).where(eq(otpCodes.id, otp.id));
  let [user] = await db.select().from(users).where(eq(users.phone, phone));
  const isNew = !user;
  if (!user) [user] = await db.insert(users).values({ phone }).returning();
  const token = signPatient(user.id);
  return { token, user, isNew };
}

export function signPatient(userId: string) {
  return jwt.sign({ sub: userId, role: 'patient' }, env.jwtSecret, { expiresIn: '90d' });
}

/**
 * Logins renew themselves: when the app checks in and its login is older than a week, it gets a fresh one.
 * So patients and counters that open the app at least once every 90 / 30 days never have to sign in again.
 */
export function renewedToken(req: FastifyRequest): string | undefined {
  const c = readClaims(req.headers.authorization);
  if (!c?.iat || Date.now() / 1000 - c.iat < 7 * 86_400) return undefined;
  if (c.role === 'patient') return signPatient(c.sub);
  if (c.role === 'agent' && c.chamberId) return signAgent(c.sub, c.chamberId);
  return undefined;
}

export function signAgent(agentId: string, chamberId: string) {
  return jwt.sign({ sub: agentId, chamberId, role: 'agent' }, env.jwtSecret, { expiresIn: '30d' });
}

export type AdminRole = 'OWNER' | 'MANAGER' | 'SUPPORT';
type Claims = { sub: string; role: 'patient' | 'agent' | 'admin'; chamberId?: string; adminRole?: AdminRole; iat?: number };

/** True when the login was made before the password was last changed. */
const stale = (c: Claims, changedAt: Date | null) => !!changedAt && (c.iat ?? 0) * 1000 < changedAt.getTime() - 1000;

export function signAdmin(adminId: string, role: AdminRole) {
  return jwt.sign({ sub: adminId, role: 'admin', adminRole: role }, env.jwtSecret, { expiresIn: '12h' });
}

export function readClaims(header?: string): Claims | null {
  if (!header?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(header.slice(7), env.jwtSecret) as Claims;
  } catch {
    return null;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    agent?: { id: string; chamberId: string };
    admin?: { id: string; role: AdminRole };
  }
}

export async function requireUser(req: FastifyRequest, _rep: FastifyReply) {
  const c = readClaims(req.headers.authorization);
  if (!c || c.role !== 'patient') throw unauthorized();
  req.userId = c.sub;
}

export async function requireAgent(req: FastifyRequest, _rep: FastifyReply) {
  const c = readClaims(req.headers.authorization);
  if (!c || c.role !== 'agent' || !c.chamberId) throw unauthorized();
  // A turned-off login or a changed password signs the counter out at once.
  const [a] = await db.select({ active: agentAccounts.active, changed: agentAccounts.passwordChangedAt }).from(agentAccounts).where(eq(agentAccounts.id, c.sub));
  if (!a || !a.active || stale(c, a.changed)) throw unauthorized();
  req.agent = { id: c.sub, chamberId: c.chamberId };
}

const RANK: Record<AdminRole, number> = { SUPPORT: 1, MANAGER: 2, OWNER: 3 };

/** Admin panel access. Pass the lowest role allowed; higher roles are allowed too. */
export function requireAdmin(min: AdminRole = 'SUPPORT') {
  return async (req: FastifyRequest, _rep: FastifyReply) => {
    const c = readClaims(req.headers.authorization);
    if (!c || c.role !== 'admin' || !c.adminRole) throw unauthorized();
    // The role is re-read so a removed or downgraded admin loses access at once, not when the token expires.
    const [a] = await db.select({ role: adminUsers.role, active: adminUsers.active, changed: adminUsers.passwordChangedAt }).from(adminUsers).where(eq(adminUsers.id, c.sub));
    if (!a || !a.active || stale(c, a.changed)) throw unauthorized();
    if (RANK[a.role] < RANK[min]) throw forbidden();
    req.admin = { id: c.sub, role: a.role };
  };
}
