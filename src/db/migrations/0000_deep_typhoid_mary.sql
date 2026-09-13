CREATE TYPE "public"."game_status" AS ENUM('scheduled', 'final', 'postponed', 'void');--> statement-breakpoint
CREATE TYPE "public"."market" AS ENUM('SPREAD', 'TOTAL');--> statement-breakpoint
CREATE TYPE "public"."pick_selection" AS ENUM('HOME', 'AWAY', 'OVER', 'UNDER');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('player', 'commish');--> statement-breakpoint
CREATE TYPE "public"."sport" AS ENUM('NFL', 'NCAA', 'CFL');--> statement-breakpoint
CREATE TYPE "public"."team_alias_source" AS ENUM('archive', 'odds_api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."week_type" AS ENUM('regular', 'thanksgiving', 'bowl', 'playoff');--> statement-breakpoint
CREATE TABLE "game" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_id" integer NOT NULL,
	"sport" "sport" NOT NULL,
	"home_team_id" integer NOT NULL,
	"away_team_id" integer NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"market" "market" NOT NULL,
	"favorite_team_id" integer,
	"spread" numeric(5, 1),
	"total_points" numeric(5, 1),
	"home_score" integer,
	"away_score" integer,
	"status" "game_status" DEFAULT 'scheduled' NOT NULL,
	"external_event_id" text,
	"source_book" text,
	"is_on_board" boolean DEFAULT false NOT NULL,
	CONSTRAINT "game_external_event_id_market_unique" UNIQUE("external_event_id","market")
);
--> statement-breakpoint
CREATE TABLE "makeup_designation" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_entry_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"designated_in_week" integer NOT NULL,
	"counts_toward_week" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pick" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_entry_id" integer NOT NULL,
	"week_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"selection" "pick_selection" NOT NULL,
	"selected_team_id" integer,
	"source" "role" DEFAULT 'player' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"override_result" text,
	"override_note" text,
	"ap_rank" integer,
	CONSTRAINT "pick_season_entry_id_week_id_game_id_unique" UNIQUE("season_entry_id","week_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "player" (
	"id" serial PRIMARY KEY NOT NULL,
	"rollup_key" text NOT NULL,
	"current_display_name" text NOT NULL,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "player_rollup_key_unique" UNIQUE("rollup_key")
);
--> statement-breakpoint
CREATE TABLE "ruling" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_id" integer NOT NULL,
	"season_entry_id" integer,
	"type" text NOT NULL,
	"description" text,
	"applied_by" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_entry" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"sponsor_player_id" integer,
	"entry_fee_paid_at" timestamp with time zone,
	"season_pool_eligible" boolean DEFAULT true NOT NULL,
	"role" "role" DEFAULT 'player' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_entry_id" integer NOT NULL,
	"week_id" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_speed_declared" boolean DEFAULT false NOT NULL,
	"pick_count" integer DEFAULT 0 NOT NULL,
	"is_auto_zero" boolean DEFAULT false NOT NULL,
	"notes" text,
	CONSTRAINT "submission_season_entry_id_week_id_unique" UNIQUE("season_entry_id","week_id")
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" "sport" NOT NULL,
	"canonical_name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_alias" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"alias" text NOT NULL,
	"source" "team_alias_source" NOT NULL,
	CONSTRAINT "team_alias_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "week" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"number" integer NOT NULL,
	"type" "week_type" NOT NULL,
	"lines_published_at" timestamp with time zone,
	"line_snapshot_at" timestamp with time zone,
	"is_speed_week_for_all" boolean DEFAULT false NOT NULL,
	"allows_string_bets_from_week" integer
);
--> statement-breakpoint
CREATE TABLE "week_board_config" (
	"week_id" integer PRIMARY KEY NOT NULL,
	"included_days_of_week" integer[] NOT NULL,
	"included_sports" "sport"[] NOT NULL,
	"eligible_team_ids" integer[],
	"max_games" integer
);
--> statement-breakpoint
CREATE TABLE "week_result" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_entry_id" integer NOT NULL,
	"week_id" integer NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"pushes" integer DEFAULT 0 NOT NULL,
	"rate_applied_cents" integer NOT NULL,
	"gross_loss_cents" integer NOT NULL,
	"weekly_win_share_cents" integer DEFAULT 0 NOT NULL,
	"denzil_award_cents" integer DEFAULT 0 NOT NULL,
	"rank_after_week" integer,
	CONSTRAINT "week_result_season_entry_id_week_id_unique" UNIQUE("season_entry_id","week_id")
);
--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_week_id_week_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."week"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_home_team_id_team_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_away_team_id_team_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_favorite_team_id_team_id_fk" FOREIGN KEY ("favorite_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_designation" ADD CONSTRAINT "makeup_designation_season_entry_id_season_entry_id_fk" FOREIGN KEY ("season_entry_id") REFERENCES "public"."season_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_designation" ADD CONSTRAINT "makeup_designation_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_designation" ADD CONSTRAINT "makeup_designation_designated_in_week_week_id_fk" FOREIGN KEY ("designated_in_week") REFERENCES "public"."week"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_designation" ADD CONSTRAINT "makeup_designation_counts_toward_week_week_id_fk" FOREIGN KEY ("counts_toward_week") REFERENCES "public"."week"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick" ADD CONSTRAINT "pick_season_entry_id_season_entry_id_fk" FOREIGN KEY ("season_entry_id") REFERENCES "public"."season_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick" ADD CONSTRAINT "pick_week_id_week_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."week"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick" ADD CONSTRAINT "pick_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick" ADD CONSTRAINT "pick_selected_team_id_team_id_fk" FOREIGN KEY ("selected_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruling" ADD CONSTRAINT "ruling_week_id_week_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."week"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruling" ADD CONSTRAINT "ruling_season_entry_id_season_entry_id_fk" FOREIGN KEY ("season_entry_id") REFERENCES "public"."season_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruling" ADD CONSTRAINT "ruling_applied_by_player_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_entry" ADD CONSTRAINT "season_entry_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_entry" ADD CONSTRAINT "season_entry_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_entry" ADD CONSTRAINT "season_entry_sponsor_player_id_player_id_fk" FOREIGN KEY ("sponsor_player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_season_entry_id_season_entry_id_fk" FOREIGN KEY ("season_entry_id") REFERENCES "public"."season_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_week_id_week_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."week"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_alias" ADD CONSTRAINT "team_alias_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week" ADD CONSTRAINT "week_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_board_config" ADD CONSTRAINT "week_board_config_week_id_week_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."week"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_result" ADD CONSTRAINT "week_result_season_entry_id_season_entry_id_fk" FOREIGN KEY ("season_entry_id") REFERENCES "public"."season_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_result" ADD CONSTRAINT "week_result_week_id_week_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."week"("id") ON DELETE no action ON UPDATE no action;