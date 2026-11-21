ALTER TABLE "admin_users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD COLUMN "password_changed_at" timestamp with time zone;