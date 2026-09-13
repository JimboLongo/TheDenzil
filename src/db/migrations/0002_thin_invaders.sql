CREATE TYPE "public"."game_source" AS ENUM('odds_api', 'manual');--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "source" "game_source" DEFAULT 'odds_api' NOT NULL;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_external_event_id_source_check" CHECK ((source = 'manual' AND external_event_id IS NULL) OR (source = 'odds_api' AND external_event_id IS NOT NULL));