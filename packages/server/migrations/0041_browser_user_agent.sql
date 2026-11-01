ALTER TABLE "connected_browsers" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "connected_browsers" ADD COLUMN "user_agent_data" jsonb;--> statement-breakpoint
ALTER TABLE "connected_browsers" ADD CONSTRAINT "connected_browsers_user_agent" CHECK (char_length("connected_browsers"."user_agent") <= 512);