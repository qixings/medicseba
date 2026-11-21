import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { db, schema } from './db.js';
import { env } from './env.js';

const { users, notifications, appSettings, messageLog, broadcasts, agentMessages, tokens, sessions, chambers } = schema;

/* ---------------- settings ---------------- */

export type NoteKind = 'booked' | 'ahead5' | 'ahead2' | 'arrived' | 'late' | 'not_coming' | 'ended' | 'requeued' | 'missed' | 'refunded' | 'moved' | 'reminder' | 'broadcast' | 'receipt';

export const WHATSAPP_EVENTS: { kind: NoteKind; label: string }[] = [
  { kind: 'booked', label: 'Serial booked' },
  { kind: 'ahead5', label: '5 patients ahead' },
  { kind: 'ahead2', label: '2 patients ahead' },
  { kind: 'arrived', label: 'Doctor arrived' },
  { kind: 'late', label: 'Doctor running late' },
  { kind: 'not_coming', label: 'Doctor not coming' },
  { kind: 'requeued', label: 'Not there, moved to end of line' },
  { kind: 'missed', label: 'Serial missed' },
  { kind: 'ended', label: 'Sitting ended before their turn' },
  { kind: 'moved', label: 'Serial moved' },
  { kind: 'broadcast', label: 'Messages from the team' },
];

export type NotifySettings = {
  whatsapp: { enabled: boolean; template: string; receiptTemplate: string; events: Partial<Record<NoteKind, boolean>> };
};

const DEFAULTS: NotifySettings = {
  whatsapp: { enabled: false, template: 'medicseba_update', receiptTemplate: 'medicseba_receipt', events: { booked: true, ahead2: true, late: true, not_coming: true, ended: true, requeued: true, missed: true, moved: true, broadcast: true } },
};

let cache: { at: number; value: NotifySettings } | null = null;

export async function getNotifySettings(): Promise<NotifySettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'notify'));
  const v = (row?.value ?? {}) as Partial<NotifySettings>;
  const value = { whatsapp: { ...DEFAULTS.whatsapp, ...(v.whatsapp ?? {}), events: { ...DEFAULTS.whatsapp.events, ...(v.whatsapp?.events ?? {}) } } };
  cache = { at: Date.now(), value };
  return value;
}

export async function saveNotifySettings(v: NotifySettings) {
  await db.insert(appSettings).values({ key: 'notify', value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
  cache = null;
}

/** WhatsApp is usable only when the server has the Meta keys. */
export const whatsappConfigured = () => !!(env.whatsappToken && env.whatsappPhoneId);

/* ---------------- SMS (login codes) ---------------- */

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

/* ---------------- WhatsApp (Meta Cloud API) ---------------- */

/** WhatsApp template parameters cannot contain new lines, tabs or long runs of spaces. */
const clean = (s: string) => s.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900);

/**
 * Send the approved utility template, whose body has two variables: {{1}} the title and {{2}} the message.
 * Messages that start a conversation must use an approved template; free text is not allowed by WhatsApp.
 */
export async function sendWhatsApp(phone: string, title: string, body: string, opts: { kind: string; lang?: string; template?: string }) {
  const to = phone.replace(/\D/g, '');
  if (!whatsappConfigured()) throw new Error('WhatsApp is not connected on the server');
  const template = opts.template ?? (await getNotifySettings()).whatsapp.template;
  const send = (code: string) => fetch(`https://graph.facebook.com/${env.whatsappApiVersion}/${env.whatsappPhoneId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.whatsappToken}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: template, language: { code }, components: [{ type: 'body', parameters: [{ type: 'text', text: clean(title) }, { type: 'text', text: clean(body) }] }] },
    }),
  });
  let res = await send(opts.lang === 'bn' ? 'bn' : 'en');
  // If the Bengali version of the template is not approved yet, fall back to English.
  if (!res.ok && opts.lang === 'bn') res = await send('en');
  const ok = res.ok;
  const error = ok ? null : ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
  await db.insert(messageLog).values({ channel: 'whatsapp', to, kind: opts.kind, status: ok ? 'sent' : 'failed', error });
  if (!ok) throw new Error(error ?? 'WhatsApp failed');
}

/**
 * Send a receipt PDF on WhatsApp with the approved receipt template: a Document header, and a body with
 * {{1}} the patient name and {{2}} the serial details.
 */
export async function sendWhatsAppReceipt(phone: string, pdfUrl: string, filename: string, name: string, details: string, lang?: string) {
  const to = phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1');
  if (!whatsappConfigured()) throw new Error('WhatsApp is not connected on the server');
  const template = (await getNotifySettings()).whatsapp.receiptTemplate;
  const send = (code: string) => fetch(`https://graph.facebook.com/${env.whatsappApiVersion}/${env.whatsappPhoneId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.whatsappToken}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: {
        name: template, language: { code },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { link: pdfUrl, filename } }] },
          { type: 'body', parameters: [{ type: 'text', text: clean(name) }, { type: 'text', text: clean(details) }] },
        ],
      },
    }),
  });
  let res = await send(lang === 'bn' ? 'bn' : 'en');
  if (!res.ok && lang === 'bn') res = await send('en');
  const error = res.ok ? null : ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
  await db.insert(messageLog).values({ channel: 'whatsapp', to, kind: 'receipt', status: res.ok ? 'sent' : 'failed', error });
  if (!res.ok) throw new Error(error ?? 'WhatsApp failed');
}

/* ---------------- push ---------------- */

async function sendPush(pushTokens: string[], title: string, body: string, data: Record<string, unknown>) {
  for (let i = 0; i < pushTokens.length; i += 100) {
    const batch = pushTokens.slice(i, i + 100);
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch.map((to) => ({ to, title, body, data, sound: 'default', channelId: 'queue' }))),
      });
    } catch (e) {
      console.warn('[push] failed', e);
    }
  }
}

/* ---------------- one patient ---------------- */

/** In-app notification + push, and WhatsApp when it is turned on for this kind of message. */
export async function notifyUser(userId: string, kind: NoteKind, title: string, body: string, data: Record<string, unknown> = {}) {
  await db.insert(notifications).values({ userId, kind, title, body, data });
  if (env.nodeEnv === 'test') return;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  await sendPush(user.pushTokens, title, body, data);
  const s = await getNotifySettings();
  if (s.whatsapp.enabled && s.whatsapp.events[kind] && whatsappConfigured()) {
    await sendWhatsApp(user.phone, title, body, { kind, lang: user.language }).catch((e) => console.warn('[whatsapp]', e.message));
  }
}

/* ---------------- broadcasts ---------------- */

export type Audience =
  | { kind: 'all_patients' }
  | { kind: 'chamber_patients'; id: string }
  | { kind: 'doctor_patients'; id: string }
  | { kind: 'sitting_patients'; id: string }
  | { kind: 'patient'; id: string }
  | { kind: 'all_counters' }
  | { kind: 'counter'; id: string };

const UPCOMING = ['BOOKED', 'ARRIVED'] as const;

/** Patients (user ids) or chambers (ids) a message would reach. Patient groups mean people with an upcoming serial there. */
export async function resolveAudience(a: Audience): Promise<{ users: string[]; chambers: string[] }> {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const upcomingUsers = async (where: ReturnType<typeof eq>) => {
    const rows = await db.selectDistinct({ id: tokens.userId }).from(tokens).innerJoin(sessions, eq(sessions.id, tokens.sessionId))
      .where(and(where, inArray(tokens.state, [...UPCOMING]), sql`${sessions.date} >= ${today}`, sql`${tokens.userId} is not null`));
    return rows.map((r) => r.id!).filter(Boolean);
  };
  switch (a.kind) {
    case 'all_patients': return { users: (await db.select({ id: users.id }).from(users)).map((u) => u.id), chambers: [] };
    case 'chamber_patients': return { users: await upcomingUsers(eq(sessions.chamberId, a.id)), chambers: [] };
    case 'doctor_patients': return { users: await upcomingUsers(eq(sessions.doctorId, a.id)), chambers: [] };
    case 'sitting_patients': {
      const rows = await db.selectDistinct({ id: tokens.userId }).from(tokens).where(and(eq(tokens.sessionId, a.id), inArray(tokens.state, [...UPCOMING]), sql`${tokens.userId} is not null`));
      return { users: rows.map((r) => r.id!).filter(Boolean), chambers: [] };
    }
    case 'patient': return { users: [a.id], chambers: [] };
    case 'all_counters': return { users: [], chambers: (await db.select({ id: chambers.id }).from(chambers)).map((c) => c.id) };
    case 'counter': return { users: [], chambers: [a.id] };
  }
}

/** Send a broadcast in the background. Progress is saved on the broadcast row. */
export async function runBroadcast(broadcastId: string) {
  const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, broadcastId));
  if (!b) return;
  const target = await resolveAudience(b.audience as Audience);
  let sent = 0;
  const data = { broadcastId: b.id };
  if (target.chambers.length) {
    await db.insert(agentMessages).values(target.chambers.map((chamberId) => ({ chamberId, broadcastId: b.id, title: b.title, body: b.body })));
    sent += target.chambers.length;
  }
  const s = await getNotifySettings();
  const useWhatsApp = b.channels.includes('whatsapp') && s.whatsapp.enabled && whatsappConfigured();
  for (let i = 0; i < target.users.length; i += 200) {
    const ids = target.users.slice(i, i + 200);
    await db.insert(notifications).values(ids.map((userId) => ({ userId, kind: 'broadcast', title: b.title, body: b.body, data })));
    if (env.nodeEnv !== 'test') {
      const list = await db.select().from(users).where(inArray(users.id, ids));
      await sendPush(list.flatMap((u) => u.pushTokens), b.title, b.body, data);
      if (useWhatsApp) {
        for (const u of list) {
          await sendWhatsApp(u.phone, b.title, b.body, { kind: 'broadcast', lang: u.language }).catch(() => {});
          await new Promise((r) => setTimeout(r, 120)); // stay well under WhatsApp's rate limits
        }
      }
    }
    sent += ids.length;
    await db.update(broadcasts).set({ sent }).where(eq(broadcasts.id, b.id));
  }
  await db.update(broadcasts).set({ sent, recipients: target.users.length + target.chambers.length, status: 'SENT' }).where(eq(broadcasts.id, b.id));
}

export async function recentMessageLog(limit = 20) {
  return db.select().from(messageLog).where(gt(messageLog.createdAt, new Date(Date.now() - 30 * 86_400_000))).orderBy(sql`${messageLog.createdAt} desc`).limit(limit);
}
