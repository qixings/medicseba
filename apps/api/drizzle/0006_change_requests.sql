CREATE TABLE "change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"chamber_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text,
	"data" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_request_status_idx" ON "change_requests" USING btree ("status","created_at");