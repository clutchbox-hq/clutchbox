ALTER TABLE "connected_browsers" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "connected_browsers" ADD COLUMN "languages" text[];--> statement-breakpoint
ALTER TABLE "connected_browsers" ADD CONSTRAINT "connected_browsers_time_zone" CHECK ("connected_browsers"."time_zone" ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$');--> statement-breakpoint
ALTER TABLE "connected_browsers" ADD CONSTRAINT "connected_browsers_languages" CHECK (cardinality("connected_browsers"."languages") BETWEEN 1 AND 10);