CREATE TYPE "public"."week_status" AS ENUM('upcoming', 'open', 'settling', 'final');--> statement-breakpoint
ALTER TABLE "week" ADD COLUMN "status" "week_status" DEFAULT 'upcoming' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "week_one_open_per_season" ON "week" USING btree ("season_id") WHERE "week"."status" = 'open';