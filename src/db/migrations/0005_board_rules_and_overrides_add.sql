CREATE TYPE "public"."board_override_action" AS ENUM('INCLUDE', 'EXCLUDE');--> statement-breakpoint
CREATE TABLE "board_override" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"action" "board_override_action" NOT NULL,
	"note" text,
	CONSTRAINT "board_override_week_id_game_id_unique" UNIQUE("week_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "ruling" ALTER COLUMN "applied_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "week_board_config" ADD COLUMN "rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "board_override" ADD CONSTRAINT "board_override_week_id_week_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."week"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_override" ADD CONSTRAINT "board_override_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE no action ON UPDATE no action;