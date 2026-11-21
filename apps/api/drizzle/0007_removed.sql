ALTER TABLE "chambers" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doctors" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "removed_at" timestamp with time zone;