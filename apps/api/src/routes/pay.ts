import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db.js';
import { env } from '../env.js';
import { notFound } from '../errors.js';



/**
 * Hosted checkout page. The app opens it in the system browser, Razorpay runs here,
 * and the result goes back to the app through its deep link. Works on Android, iPhone
 * and web without a native payment module.
 */
export async function payRoutes(app: FastifyInstance) {
  app.get('/pay/:orderId', async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    const { redirect } = z.object({ redirect: z.string().regex(/^(kailash|https?|exp):\/\//) }).parse(req.query);
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.providerOrderId, orderId));
    if (!p || p.status !== 'CREATED') throw notFound('Order');
    const back = (q: Record<string, string>) => `${redirect}${redirect.includes('?') ? '&' : '?'}${new URLSearchParams(q)}`;
    const mock = env.paymentProvider !== 'razorpay';
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay ₹${p.amount}</title>
<style>body{margin:0;font-family:-apple-system,Inter,sans-serif;background:#F3F5F9;color:#0B1220;display:flex;min-height:100vh;align-items:center;justify-content:center}
.c{background:#fff;border-radius:24px;padding:28px;width:min(340px,86vw);text-align:center;box-shadow:0 6px 14px -6px rgba(11,18,32,.18)}
h1{margin:0 0 6px;font-size:40px;font-weight:900}p{margin:0 0 20px;color:rgba(11,18,32,.66)}
button{width:100%;height:54px;border:0;border-radius:16px;background:#1ACDD4;color:#fff;font-size:17px;font-weight:800}</style></head>
<body><div class="c"><h1>₹${p.amount}</h1><p>Token booking payment</p><button id="b">Pay now</button></div>
${mock ? '' : '<script src="https://checkout.razorpay.com/v1/checkout.js"></script>'}
<script>
const ok = ${JSON.stringify(back({ orderId, status: 'paid', paymentId: '__P', signature: '__S' }))};
const fail = ${JSON.stringify(back({ orderId, status: 'failed' }))};
const go = (u) => { location.href = u; };
const done = (pid, sig) => go(ok.replace('__P', encodeURIComponent(pid)).replace('__S', encodeURIComponent(sig)));
document.getElementById('b').onclick = () => {
  ${mock ? "done('pay_mock_' + Date.now(), 'mock_ok');" : `new Razorpay({ key: ${JSON.stringify(env.razorpayKeyId)}, order_id: ${JSON.stringify(orderId)}, amount: ${p.amount * 100}, currency: 'INR', name: 'Token booking',
    theme: { color: '#1ACDD4' }, handler: (r) => done(r.razorpay_payment_id, r.razorpay_signature), modal: { ondismiss: () => go(fail) } }).open();`}
};
${mock ? '' : "document.getElementById('b').click();"}
</script></body></html>`;

    return reply.type('text/html').send(html);
  });
}
