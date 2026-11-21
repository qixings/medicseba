ALTER TABLE "tokens" ADD COLUMN "queue_pos" integer;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "miss_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "paid_amount" integer;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "paid_method" text;--> statement-breakpoint
UPDATE "tokens" SET "queue_pos" = "number" WHERE "queue_pos" IS NULL AND "number" IS NOT NULL;
