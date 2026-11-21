CREATE TYPE "public"."chamber_kind" AS ENUM('PHARMACY', 'OWN');--> statement-breakpoint
CREATE TYPE "public"."doctor_status" AS ENUM('ON_TIME', 'LATE', 'ARRIVED', 'BREAK', 'NOT_COMING', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('CREATED', 'PAID', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('OPEN', 'CLOSED', 'CANCELLED', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."token_source" AS ENUM('ONLINE', 'WALKIN');--> statement-breakpoint
CREATE TYPE "public"."token_state" AS ENUM('HELD', 'BOOKED', 'ARRIVED', 'SERVING', 'DONE', 'MISSED', 'NO_SHOW', 'CANCELLED', 'REFUNDED', 'MOVED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "agent_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"chamber_id" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_accounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "chambers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "chamber_kind" DEFAULT 'PHARMACY' NOT NULL,
	"photos" text[] DEFAULT '{}' NOT NULL,
	"address" text NOT NULL,
	"area" text NOT NULL,
	"landmark" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"phone" text DEFAULT '' NOT NULL,
	"opening_hours" text DEFAULT '' NOT NULL,
	"booking_fee" integer DEFAULT 55 NOT NULL,
	"platform_fee" integer DEFAULT 10 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"photo_url" text,
	"degrees" text NOT NULL,
	"specialty_id" text NOT NULL,
	"experience_years" integer DEFAULT 0 NOT NULL,
	"consult_fee" integer DEFAULT 0 NOT NULL,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"booking_window_days" integer DEFAULT 7 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_members" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"age" integer NOT NULL,
	"gender" "gender" NOT NULL,
	"relation" text,
	"is_self" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"amount" integer NOT NULL,
	"booking_fee" integer NOT NULL,
	"platform_fee" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"provider_refund_id" text,
	"status" "payment_status" DEFAULT 'CREATED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_token_id_unique" UNIQUE("token_id"),
	CONSTRAINT "payments_provider_order_id_unique" UNIQUE("provider_order_id")
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"doctor_id" text NOT NULL,
	"chamber_id" text NOT NULL,
	"weekdays" integer[] NOT NULL,
	"start_time" text NOT NULL,
	"token_limit" integer DEFAULT 40 NOT NULL,
	"online_share" integer DEFAULT 60 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"doctor_id" text NOT NULL,
	"chamber_id" text NOT NULL,
	"date" text NOT NULL,
	"start_time" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"token_limit" integer NOT NULL,
	"online_limit" integer NOT NULL,
	"online_taken" integer DEFAULT 0 NOT NULL,
	"counter_taken" integer DEFAULT 0 NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"serving_number" integer DEFAULT 0 NOT NULL,
	"status" "session_status" DEFAULT 'OPEN' NOT NULL,
	"doctor_status" "doctor_status" DEFAULT 'ON_TIME' NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"arrived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialties" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'steth' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "specialties_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"number" integer,
	"source" "token_source" NOT NULL,
	"state" "token_state" NOT NULL,
	"user_id" text,
	"member_id" text,
	"patient_name" text NOT NULL,
	"patient_age" integer,
	"patient_gender" "gender",
	"phone" text,
	"hold_expires_at" timestamp with time zone,
	"reschedule_used" boolean DEFAULT false NOT NULL,
	"moved_from_id" text,
	"absent_choice" text,
	"served_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"language" text DEFAULT 'en' NOT NULL,
	"push_tokens" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_member_id_family_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_phone_idx" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_schedule_date" ON "sessions" USING btree ("schedule_id","date");--> statement-breakpoint
CREATE INDEX "session_date_idx" ON "sessions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "token_session_number" ON "tokens" USING btree ("session_id","number");--> statement-breakpoint
CREATE INDEX "token_user_idx" ON "tokens" USING btree ("user_id");