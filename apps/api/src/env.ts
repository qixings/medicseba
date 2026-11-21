import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: req('JWT_SECRET'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  paymentProvider: (process.env.PAYMENT_PROVIDER ?? 'mock') as 'mock' | 'razorpay',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  smsProvider: (process.env.SMS_PROVIDER ?? 'log') as 'log' | 'msg91',
  msg91AuthKey: process.env.MSG91_AUTH_KEY ?? '',
  msg91TemplateId: process.env.MSG91_TEMPLATE_ID ?? '',
  holdMinutes: Number(process.env.HOLD_MINUTES ?? 5),
  rescheduleCutoffMinutes: Number(process.env.RESCHEDULE_CUTOFF_MINUTES ?? 120),
  avgMinutesPerPatient: Number(process.env.AVG_MINUTES_PER_PATIENT ?? 7),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};
