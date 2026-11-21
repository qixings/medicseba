import { boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';

const id = () => text('id').primaryKey().$defaultFn(() => randomUUID());
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const chamberKind = pgEnum('chamber_kind', ['PHARMACY', 'OWN']);
export const sessionStatus = pgEnum('session_status', ['OPEN', 'CLOSED', 'CANCELLED', 'ENDED']);
export const doctorStatus = pgEnum('doctor_status', ['ON_TIME', 'LATE', 'ARRIVED', 'BREAK', 'NOT_COMING', 'ENDED']);
export const tokenSource = pgEnum('token_source', ['ONLINE', 'WALKIN']);
export const tokenState = pgEnum('token_state', ['HELD', 'BOOKED', 'ARRIVED', 'SERVING', 'DONE', 'MISSED', 'NO_SHOW', 'CANCELLED', 'REFUNDED', 'MOVED', 'EXPIRED']);
export const paymentStatus = pgEnum('payment_status', ['CREATED', 'PAID', 'FAILED', 'REFUNDED']);
export const gender = pgEnum('gender', ['MALE', 'FEMALE', 'OTHER']);
export const adminRole = pgEnum('admin_role', ['OWNER', 'MANAGER', 'SUPPORT']);
export const settlementStatus = pgEnum('settlement_status', ['PENDING', 'PAID']);

export const users = pgTable('users', {
  id: id(),
  phone: text('phone').notNull().unique(),
  name: text('name'),
  language: text('language').notNull().default('en'),
  pushTokens: text('push_tokens').array().notNull().default([]),
  createdAt: createdAt(),
});

export const otpCodes = pgTable('otp_codes', {
  id: id(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('otp_phone_idx').on(t.phone, t.createdAt)]);

export const familyMembers = pgTable('family_members', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  age: integer('age').notNull(),
  gender: gender('gender').notNull(),
  relation: text('relation'),
  isSelf: boolean('is_self').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const specialties = pgTable('specialties', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('steth'),
  order: integer('order').notNull().default(0),
});

export const doctors = pgTable('doctors', {
  id: id(),
  name: text('name').notNull(),
  photoUrl: text('photo_url'),
  degrees: text('degrees').notNull(),
  specialtyId: text('specialty_id').notNull().references(() => specialties.id),
  experienceYears: integer('experience_years').notNull().default(0),
  consultFee: integer('consult_fee').notNull().default(0),
  languages: text('languages').array().notNull().default([]),
  bio: text('bio').notNull().default(''),
  bookingWindowDays: integer('booking_window_days').notNull().default(7),
  ratingSum: integer('rating_sum').notNull().default(0),
  ratingCount: integer('rating_count').notNull().default(0),
  visible: boolean('visible').notNull().default(true),
  createdAt: createdAt(),
});

export const chambers = pgTable('chambers', {
  id: id(),
  name: text('name').notNull(),
  kind: chamberKind('kind').notNull().default('PHARMACY'),
  photos: text('photos').array().notNull().default([]),
  address: text('address').notNull(),
  area: text('area').notNull(),
  landmark: text('landmark').notNull().default(''),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  phone: text('phone').notNull().default(''),
  openingHours: text('opening_hours').notNull().default(''),
  bookingFee: integer('booking_fee').notNull().default(55),
  platformFee: integer('platform_fee').notNull().default(10),
  visible: boolean('visible').notNull().default(true),
  createdAt: createdAt(),
});

export const schedules = pgTable('schedules', {
  id: id(),
  doctorId: text('doctor_id').notNull().references(() => doctors.id),
  chamberId: text('chamber_id').notNull().references(() => chambers.id),
  weekdays: integer('weekdays').array().notNull(),
  startTime: text('start_time').notNull(),
  tokenLimit: integer('token_limit').notNull().default(40),
  onlineShare: integer('online_share').notNull().default(60),
  active: boolean('active').notNull().default(true),
});

export const sessions = pgTable('sessions', {
  id: id(),
  scheduleId: text('schedule_id').notNull().references(() => schedules.id),
  doctorId: text('doctor_id').notNull().references(() => doctors.id),
  chamberId: text('chamber_id').notNull().references(() => chambers.id),
  date: text('date').notNull(),
  startTime: text('start_time').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  tokenLimit: integer('token_limit').notNull(),
  onlineLimit: integer('online_limit').notNull(),
  onlineTaken: integer('online_taken').notNull().default(0),
  counterTaken: integer('counter_taken').notNull().default(0),
  nextNumber: integer('next_number').notNull().default(1),
  servingNumber: integer('serving_number').notNull().default(0),
  status: sessionStatus('status').notNull().default('OPEN'),
  doctorStatus: doctorStatus('doctor_status').notNull().default('ON_TIME'),
  lateMinutes: integer('late_minutes').notNull().default(0),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('session_schedule_date').on(t.scheduleId, t.date), index('session_date_idx').on(t.date)]);

export const tokens = pgTable('tokens', {
  id: id(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  number: integer('number'),
  source: tokenSource('source').notNull(),
  state: tokenState('state').notNull(),
  userId: text('user_id').references(() => users.id),
  memberId: text('member_id').references(() => familyMembers.id),
  patientName: text('patient_name').notNull(),
  patientAge: integer('patient_age'),
  patientGender: gender('patient_gender'),
  phone: text('phone'),
  holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
  rescheduleUsed: boolean('reschedule_used').notNull().default(false),
  movedFromId: text('moved_from_id'),
  absentChoice: text('absent_choice'),
  servedAt: timestamp('served_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
  /** Place in the line. Starts equal to the serial number; a patient who was not there when called moves to the end. */
  queuePos: integer('queue_pos'),
  /** How many times the patient was called and not there (2nd time = missed). */
  missCount: integer('miss_count').notNull().default(0),
  /** Counter payment for walk-ins (rupees), and how it was paid. */
  paidAmount: integer('paid_amount'),
  paidMethod: text('paid_method'),
  /** Set by the agent app for walk-ins, so a walk-in sent twice (offline retry) is only added once. */
  clientRef: text('client_ref').unique(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('token_session_number').on(t.sessionId, t.number), index('token_user_idx').on(t.userId)]);

export const payments = pgTable('payments', {
  id: id(),
  tokenId: text('token_id').notNull().unique().references(() => tokens.id),
  amount: integer('amount').notNull(),
  bookingFee: integer('booking_fee').notNull(),
  platformFee: integer('platform_fee').notNull(),
  provider: text('provider').notNull(),
  providerOrderId: text('provider_order_id').notNull().unique(),
  providerPaymentId: text('provider_payment_id'),
  providerRefundId: text('provider_refund_id'),
  status: paymentStatus('status').notNull().default('CREATED'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const agentAccounts = pgTable('agent_accounts', {
  id: id(),
  chamberId: text('chamber_id').notNull().references(() => chambers.id),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  /** Logins made before this time stop working (password changed or login turned off). */
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
});

export const notifications = pgTable('notifications', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  read: boolean('read').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index('notification_user_idx').on(t.userId, t.createdAt)]);

export type Session = typeof sessions.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type Doctor = typeof doctors.$inferSelect;
export type Chamber = typeof chambers.$inferSelect;
export type Specialty = typeof specialties.$inferSelect;
export type TokenState = Token['state'];
export type DoctorStatus = Session['doctorStatus'];

/** People who run MedicSeba. OWNER: everything. MANAGER: doctors, chambers, sittings, refunds. SUPPORT: look up and help. */
export const adminUsers = pgTable('admin_users', {
  id: id(),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: adminRole('role').notNull().default('SUPPORT'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
});

/** What MedicSeba owes each chamber for one day of online bookings (their booking fee share). */
export const settlements = pgTable('settlements', {
  id: id(),
  chamberId: text('chamber_id').notNull().references(() => chambers.id),
  date: text('date').notNull(),
  bookings: integer('bookings').notNull(),
  bookingFees: integer('booking_fees').notNull(),
  platformFees: integer('platform_fees').notNull(),
  refunds: integer('refunds').notNull().default(0),
  amount: integer('amount').notNull(),
  status: settlementStatus('status').notNull().default('PENDING'),
  reference: text('reference'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paidBy: text('paid_by'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('settlement_chamber_date').on(t.chamberId, t.date)]);

/** Who changed what in the admin panel. */
export const auditLog = pgTable('audit_log', {
  id: id(),
  adminId: text('admin_id').notNull(),
  action: text('action').notNull(),
  target: text('target'),
  data: jsonb('data').notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index('audit_created_idx').on(t.createdAt)]);

/** Small settings the owner can change in the admin panel (secrets stay in the server's .env). */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A message the team sent to many patients or to chamber counters. */
export const broadcasts = pgTable('broadcasts', {
  id: id(),
  adminId: text('admin_id').notNull(),
  audience: jsonb('audience').$type<{ kind: string; id?: string; label: string }>().notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  channels: text('channels').array().notNull(),
  recipients: integer('recipients').notNull().default(0),
  sent: integer('sent').notNull().default(0),
  status: text('status').notNull().default('SENDING'),
  createdAt: createdAt(),
});

/** Messages shown in the chamber counter app. */
export const agentMessages = pgTable('agent_messages', {
  id: id(),
  chamberId: text('chamber_id').notNull().references(() => chambers.id),
  broadcastId: text('broadcast_id'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('agent_message_chamber_idx').on(t.chamberId, t.createdAt)]);

/** Every WhatsApp or SMS we tried to send, to see what failed. */
export const messageLog = pgTable('message_log', {
  id: id(),
  channel: text('channel').notNull(),
  to: text('to').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  createdAt: createdAt(),
}, (t) => [index('message_log_created_idx').on(t.createdAt)]);

/** Changes a chamber asks for from the counter app that need the team's approval (new doctors, doctor details, fees). */
export const changeRequests = pgTable('change_requests', {
  id: id(),
  chamberId: text('chamber_id').notNull().references(() => chambers.id),
  kind: text('kind').notNull(), // new_doctor | doctor_update | fees
  targetId: text('target_id'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING | APPROVED | REJECTED
  note: text('note'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('change_request_status_idx').on(t.status, t.createdAt)]);
