import { eq } from 'drizzle-orm';
import { db, schema } from './db.js';
import { env } from './env.js';

/** SMS for login codes. 'log' prints the code (development); 'msg91' sends through MSG91's OTP API. */
export async function sendOtpSms(phone: string, code: string) {
  if (env.smsProvider === 'log') {
    if (env.nodeEnv !== 'test') console.log(`[otp] ${phone} -> ${code}`);
    return;
  }
  const res = await fetch('https://control.msg91.com/api/v5/otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authkey: env.msg91AuthKey },
    body: JSON.stringify({ template_id: env.msg91TemplateId, mobile: phone.replace('+', ''), otp: code }),
  });
  if (!res.ok) throw new Error(`SMS failed: ${res.status}`);
}

export type NoteKind = 'booked' | 'ahead5' | 'ahead2' | 'arrived' | 'late' | 'not_coming' | 'refunded' | 'moved' | 'reminder';

/** Save an in-app notification and send a push to the user's devices (Expo push service). */
export async function notifyUser(userId: string, kind: NoteKind, title: string, body: string, data: Record<string, unknown> = {}) {
  await db.insert(schema.notifications).values({ userId, kind, title, body, data });
  if (env.nodeEnv === 'test') return;
  const [user] = await db.select({ pushTokens: schema.users.pushTokens }).from(schema.users).where(eq(schema.users.id, userId));
  const tokens = user?.pushTokens ?? [];
  if (!tokens.length) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, data, sound: 'default' }))),
    });
  } catch (e) {
    console.warn('[push] failed', e);
  }
  // WhatsApp template messages go here once a WhatsApp Business provider is configured.
}
