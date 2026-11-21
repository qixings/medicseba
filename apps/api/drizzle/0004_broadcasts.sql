CREATE TABLE "agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chamber_id" text NOT NULL,
	"broadcast_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"audience" jsonb NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"channels" text[] NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'SENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_message_chamber_idx" ON "agent_messages" USING btree ("chamber_id","created_at");--> statement-breakpoint
CREATE INDEX "message_log_created_idx" ON "message_log" USING btree ("created_at");