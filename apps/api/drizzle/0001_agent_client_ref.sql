ALTER TABLE "tokens" ADD COLUMN "client_ref" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_client_ref_unique" UNIQUE("client_ref");