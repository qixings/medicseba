import crypto from 'node:crypto';
import { env } from './env.js';
import { badRequest } from './errors.js';

export type Order = { provider: 'mock' | 'razorpay'; orderId: string; amount: number; currency: 'INR'; keyId?: string };

const rzpAuth = () => 'Basic ' + Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString('base64');

/** Create a payment order for an amount in rupees. */
export async function createOrder(amountRupees: number, receipt: string): Promise<Order> {
  if (env.paymentProvider === 'mock') {
    return { provider: 'mock', orderId: `mock_order_${crypto.randomUUID()}`, amount: amountRupees, currency: 'INR' };
  }
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: rzpAuth() },
    body: JSON.stringify({ amount: amountRupees * 100, currency: 'INR', receipt }),
  });
  if (!res.ok) throw new Error(`Razorpay order failed: ${res.status} ${await res.text()}`);
  const o = (await res.json()) as { id: string };
  return { provider: 'razorpay', orderId: o.id, amount: amountRupees, currency: 'INR', keyId: env.razorpayKeyId };
}

/** Check the signature the checkout returns after a successful payment. */
export function verifyCheckout(orderId: string, paymentId: string, signature: string) {
  if (env.paymentProvider === 'mock') {
    if (signature !== 'mock_ok') throw badRequest('payment_failed', 'Payment was not completed');
    return;
  }
  const expected = crypto.createHmac('sha256', env.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest('hex');
  const ok = expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!ok) throw badRequest('payment_failed', 'Payment could not be verified');
}

export function verifyWebhook(rawBody: string, signature: string) {
  const expected = crypto.createHmac('sha256', env.razorpayWebhookSecret).update(rawBody).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Full refund of a captured payment. Returns the provider refund id. */
export async function refund(paymentId: string | null, amountRupees: number): Promise<string> {
  if (env.paymentProvider === 'mock' || !paymentId) return `mock_refund_${crypto.randomUUID()}`;
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: rzpAuth() },
    body: JSON.stringify({ amount: amountRupees * 100 }),
  });
  if (!res.ok) throw new Error(`Razorpay refund failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}
