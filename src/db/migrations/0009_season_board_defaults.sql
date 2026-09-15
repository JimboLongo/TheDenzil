CREATE TABLE "season_board_defaults" (
	"season_id" integer PRIMARY KEY NOT NULL,
	"nfl_team_ids" integer[],
	"ncaa_team_ids" integer[],
	"grid" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_board_defaults" ADD CONSTRAINT "season_board_defaults_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;