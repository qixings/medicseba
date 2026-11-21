import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { requireAgent, requireUser } from '../auth.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { receiptData, receiptOk, receiptPdf, receiptUrl } from '../receipts.js';
import { getNotifySettings, sendWhatsAppReceipt, whatsappConfigured } from '../notify.js';
import { prettyDate, prettyTime } from '../time.js';

const { tokens, users } = schema;

/** Send a serial's receipt on WhatsApp. */
async function sendReceipt(tokenId: string, phone: string, lang?: string) {
  const s = await getNotifySettings();
  if (!whatsappConfigured() || !s.whatsapp.enabled) throw new ApiError(409, 'whatsapp_off', 'WhatsApp is not turned on yet. Download the receipt instead.');
  const r = await receiptData(tokenId);
  const details = `Serial ${r.tokens.number}, ${r.doctors.name}, ${r.chambers.name}, ${prettyDate(r.sessions.date)} ${prettyTime(r.sessions.startTime)}`;
  try {
    await sendWhatsAppReceipt(phone, receiptUrl(tokenId), `MedicSeba-serial-${r.tokens.number}.pdf`, r.tokens.patientName, details, lang);
  } catch (e) {
    throw new ApiError(502, 'whatsapp_failed', (e as Error).message);
  }
}

export async function receiptRoutes(app: FastifyInstance) {
  /** The receipt PDF. The link carries a signature, so it works when opened from WhatsApp. */
  app.get('/receipts/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const { sig } = z.object({ sig: z.string() }).parse(req.query);
    const id = file.replace(/\.pdf$/, '');
    if (!receiptOk(id, sig)) throw notFound('Receipt');
    const pdf = await receiptPdf(id);
    const [t] = await db.select({ n: tokens.number }).from(tokens).where(eq(tokens.id, id));
    return reply.type('application/pdf').header('content-disposition', `inline; filename="MedicSeba-serial-${t?.n ?? ''}.pdf"`).header('cache-control', 'private, max-age=60').send(pdf);
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireUser);
    const own = async (userId: string, id: string) => {
      const [t] = await db.select().from(tokens).where(eq(tokens.id, id));
      if (!t || t.userId !== userId) throw notFound('Booking');
      if (t.number === null) throw badRequest('no_receipt', 'This booking has no receipt yet');
      return t;
    };
    r.get('/bookings/:id/receipt', async (req) => {
      const t = await own(req.userId!, (req.params as { id: string }).id);
      const s = await getNotifySettings();
      return { url: receiptUrl(t.id), whatsapp: whatsappConfigured() && s.whatsapp.enabled };
    });
    r.post('/bookings/:id/receipt/whatsapp', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
      const t = await own(req.userId!, (req.params as { id: string }).id);
      const [u] = await db.select().from(users).where(eq(users.id, req.userId!));
      await sendReceipt(t.id, u.phone, u.language);
      return { ok: true };
    });
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAgent);
    /** Receipt link for the counter to print, and optionally send to the patient's WhatsApp. */
    r.post('/agent/tokens/:id/receipt', async (req) => {
      const { whatsapp, phone } = z.object({ whatsapp: z.boolean().default(false), phone: z.string().optional() }).parse(req.body ?? {});
      const id = (req.params as { id: string }).id;
      const r_ = await receiptData(id);
      if (r_.sessions.chamberId !== req.agent!.chamberId) throw forbidden();
      let sent = false;
      if (whatsapp) {
        const to = phone ?? r_.tokens.phone ?? (r_.tokens.userId ? (await db.select().from(users).where(eq(users.id, r_.tokens.userId)))[0]?.phone : null);
        if (!to) throw badRequest('no_phone', 'No WhatsApp number for this patient');
        if (phone && r_.tokens.source === 'WALKIN') await db.update(tokens).set({ phone }).where(eq(tokens.id, id));
        await sendReceipt(id, to);
        sent = true;
      }
      return { url: receiptUrl(id), sent };
    });
  });
}
