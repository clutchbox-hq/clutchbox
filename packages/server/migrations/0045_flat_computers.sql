-- Flat computers: a member has several computers, none of them a main computer, fork, or snapshot. This release's code
-- neither reads nor writes computers.fork_of, snapshot_id, snapshot_due_at, pinned_at, screen, or screen_fixed_at,
-- computer_profiles.snapshot_id, organizations.max_running_forks, or computer_snapshots, so they leave the schema here
-- and a later release drops them. The code still serving while this runs uses them, so their generated DROPs, and those
-- of their checks and indexes, are left out; the checks pass every row this code writes.
--
-- computers_main_unique allowed one computer with a null fork_of per member, so it goes. The code still serving relies
-- on a conflict there to find a member's main computer rather than make a second, so a narrower index keeps that for
-- its rows: only those leave last_used_at null, which this code always sets. It goes when fork_of does.
DROP INDEX "computers_main_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "computers_legacy_main_unique" ON "computers" USING btree ("membership_id") WHERE "fork_of" IS NULL AND "last_used_at" IS NULL;--> statement-breakpoint
-- Existing rows are computers like any: deleting what was a main computer must not delete what were its forks.
ALTER TABLE "computers" DROP CONSTRAINT "computers_fork_of_computers_id_fk";
