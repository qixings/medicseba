import type { FastifyInstance } from 'fastify';
import { verifyWebhook } from '../payments.js';
import { confirmPayment } from '../booking.js';

/** Razorpay webhook: confirms bookings even if the app closed during payment. */
export async function webhookRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    r.post('/webhooks/razorpay', async (req, reply) => {
      const raw = req.body as string;
      const sig = String(req.headers['x-razorpay-signature'] ?? '');
      if (!verifyWebhook(raw, sig)) return reply.code(400).send({ error: 'bad_signature' });
      const evt = JSON.parse(raw) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string } } } };
      const p = evt.payload?.payment?.entity;
      if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && p?.order_id) {
        try {
          await confirmPayment(p.order_id, p.id, null);
        } catch (e) {
          req.log.warn({ err: e }, 'webhook confirm failed');
        }
      }
      return { ok: true };
    });
  });
}
