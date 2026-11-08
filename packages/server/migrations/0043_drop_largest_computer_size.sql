-- The 8 CPU size is gone: members and computers on it move to the 4 CPU size, and its recorded time joins that size's.
UPDATE "memberships" SET "computer_size" = '2x' WHERE "computer_size" = '4x';--> statement-breakpoint
UPDATE "computers" SET "size" = '2x' WHERE "size" = '4x';--> statement-breakpoint
INSERT INTO "computer_time" ("membership_id", "day", "size", "account", "run_seconds", "pauses")
SELECT "membership_id", "day", '2x', "account", "run_seconds", "pauses" FROM "computer_time" WHERE "size" = '4x'
ON CONFLICT ("membership_id", "day", "size", "account") DO UPDATE SET
  "run_seconds" = "computer_time"."run_seconds" + excluded."run_seconds",
  "pauses" = "computer_time"."pauses" + excluded."pauses";--> statement-breakpoint
DELETE FROM "computer_time" WHERE "size" = '4x';--> statement-breakpoint
ALTER TABLE "computer_time" DROP CONSTRAINT "computer_time_size";--> statement-breakpoint
ALTER TABLE "computers" DROP CONSTRAINT "computers_size";--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_computer_size";--> statement-breakpoint
ALTER TABLE "computer_time" ADD CONSTRAINT "computer_time_size" CHECK ("computer_time"."size" IN ('1x', '2x'));--> statement-breakpoint
ALTER TABLE "computers" ADD CONSTRAINT "computers_size" CHECK ("computers"."size" IN ('1x', '2x'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_computer_size" CHECK ("memberships"."computer_size" IN ('1x', '2x'));