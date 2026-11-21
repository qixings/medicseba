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
  /** WhatsApp Business (Meta Cloud API). Leave empty to keep WhatsApp off. */
  whatsappToken: process.env.WHATSAPP_TOKEN ?? '',
  whatsappPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
  /** Where uploaded photos are kept. */
  uploadDir: process.env.UPLOAD_DIR ?? new URL('../uploads', import.meta.url).pathname,
  /** Test server: shows the OTP on screen and allows test payments, even in production. */
  demoMode: process.env.DEMO_MODE === '1',
};

if (env.nodeEnv === 'production' && !env.demoMode) {
  if (env.paymentProvider !== 'razorpay') throw new Error('Production needs PAYMENT_PROVIDER=razorpay (or DEMO_MODE=1 for a test server)');
  if (env.smsProvider !== 'msg91') throw new Error('Production needs SMS_PROVIDER=msg91 (or DEMO_MODE=1 for a test server)');
  if (env.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
}
