import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { API_URL, post } from './api';
import type { Hold, Live } from './types';

export class PayCancelled extends Error {}

/**
 * Take the payment for a held token and confirm it with the API.
 * Test mode confirms straight away. Razorpay runs on our hosted checkout page in the
 * system browser and comes back through the app's link, so no native module is needed.
 */
export async function payForHold(hold: Hold): Promise<Live> {
  const { order } = hold;
  if (order.provider === 'mock') {
    return post<Live>('/bookings/confirm', { orderId: order.orderId, paymentId: `pay_mock_${Date.now()}`, signature: 'mock_ok' });
  }
  const back = Linking.createURL('/pay-return');
  const url = `${API_URL}/v1/pay/${encodeURIComponent(order.orderId)}?redirect=${encodeURIComponent(back)}`;
  const r = await WebBrowser.openAuthSessionAsync(url, back);
  if (r.type !== 'success') throw new PayCancelled('cancelled');
  const q = Linking.parse(r.url).queryParams ?? {};
  if (q.status !== 'paid' || typeof q.paymentId !== 'string' || typeof q.signature !== 'string') throw new PayCancelled('failed');
  return post<Live>('/bookings/confirm', { orderId: order.orderId, paymentId: q.paymentId, signature: q.signature });
}
