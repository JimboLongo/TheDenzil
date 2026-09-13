import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  numeric,
  unique,
} from "drizzle-orm/pg-core";

export const sportEnum = pgEnum("sport", ["NFL", "NCAA", "CFL"]);
export const marketEnum = pgEnum("market", ["SPREAD", "TOTAL"]);
export const gameStatusEnum = pgEnum("game_status", [
  "scheduled",
  "final",
  "postponed",
  "void",
]);
export const pickSelectionEnum = pgEnum("pick_selection", [
  "HOME",
  "AWAY",
  "OVER",
  "UNDER",
]);
export const roleEnum = pgEnum("role", ["player", "commish"]);
export const weekTypeEnum = pgEnum("week_type", [
  "regular",
  "thanksgiving",
  "bowl",
  "playoff",
]);
export const teamAliasSourceEnum = pgEnum("team_alias_source", [
  "archive",
  "odds_api",
  "manual",
]);

export const team = pgTable("team", {
  id: serial("id").primaryKey(),
  sport: sportEnum("sport").notNull(),
  canonicalName: text("canonical_name").notNull(),
  abbreviation: text("abbreviation").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const teamAlias = pgTable("team_alias", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id")
    .notNull()
    .references(() => team.id),
  alias: text("alias").notNull().unique(),
  source: teamAliasSourceEnum("source").notNull(),
});

export const player = pgTable("player", {
  id: serial("id").primaryKey(),
  rollupKey: text("rollup_key").notNull().unique(),
  currentDisplayName: text("current_display_name").notNull(),
  email: text("email"),
  isActive: boolean("is_active").notNull().default(true),
});

export const season = pgTable("season", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  config: jsonb("config").notNull(),
  status: text("status").notNull(),
});

export const seasonEntry = pgTable("season_entry", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id")
    .notNull()
    .references(() => season.id),
  playerId: integer("player_id")
    .notNull()
    .references(() => player.id),
  displayName: text("display_name").notNull(),
  sponsorPlayerId: integer("sponsor_player_id").references(() => player.id),
  entryFeePaidAt: timestamp("entry_fee_paid_at", { withTimezone: true }),
  seasonPoolEligible: boolean("season_pool_eligible").notNull().default(true),
  role: roleEnum("role").notNull().default("player"),
});

export const week = pgTable("week", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id")
    .notNull()
    .references(() => season.id),
  number: integer("number").notNull(),
  type: weekTypeEnum("type").notNull(),
  linesPublishedAt: timestamp("lines_published_at", { withTimezone: true }),
  lineSnapshotAt: timestamp("line_snapshot_at", { withTimezone: true }),
  isSpeedWeekForAll: boolean("is_speed_week_for_all").notNull().default(false),
  allowsStringBetsFromWeek: integer("allows_string_bets_from_week"),
});

export const weekBoardConfig = pgTable("week_board_config", {
  weekId: integer("week_id")
    .primaryKey()
    .references(() => week.id),
  includedDaysOfWeek: integer("included_days_of_week").array().notNull(),
  includedSports: sportEnum("included_sports").array().notNull(),
  eligibleTeamIds: integer("eligible_team_ids").array(),
  maxGames: integer("max_games"),
});

export const game = pgTable(
  "game",
  {
    id: serial("id").primaryKey(),
    weekId: integer("week_id")
      .notNull()
      .references(() => week.id),
    sport: sportEnum("sport").notNull(),
    homeTeamId: integer("home_team_id")
      .notNull()
      .references(() => team.id),
    awayTeamId: integer("away_team_id")
      .notNull()
      .references(() => team.id),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
    market: marketEnum("market").notNull(),
    favoriteTeamId: integer("favorite_team_id").references(() => team.id),
    spread: numeric("spread", { precision: 5, scale: 1 }),
    totalPoints: numeric("total_points", { precision: 5, scale: 1 }),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    status: gameStatusEnum("status").notNull().default("scheduled"),
    externalEventId: text("external_event_id"),
    sourceBook: text("source_book"),
    isOnBoard: boolean("is_on_board").notNull().default(false),
  },
  (t) => [unique().on(t.externalEventId, t.market)],
);

export const pick = pgTable(
  "pick",
  {
    id: serial("id").primaryKey(),
    seasonEntryId: integer("season_entry_id")
      .notNull()
      .references(() => seasonEntry.id),
    weekId: integer("week_id")
      .notNull()
      .references(() => week.id),
    gameId: integer("game_id")
      .notNull()
      .references(() => game.id),
    selection: pickSelectionEnum("selection").notNull(),
    selectedTeamId: integer("selected_team_id").references(() => team.id),
    source: roleEnum("source").notNull().default("player"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    overrideResult: text("override_result"),
    overrideNote: text("override_note"),
    apRank: integer("ap_rank"),
  },
  (t) => [unique().on(t.seasonEntryId, t.weekId, t.gameId)],
);

export const submission = pgTable(
  "submission",
  {
    id: serial("id").primaryKey(),
    seasonEntryId: integer("season_entry_id")
      .notNull()
      .references(() => seasonEntry.id),
    weekId: integer("week_id")
      .notNull()
      .references(() => week.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    isSpeedDeclared: boolean("is_speed_declared").notNull().default(false),
    pickCount: integer("pick_count").notNull().default(0),
    isAutoZero: boolean("is_auto_zero").notNull().default(false),
    notes: text("notes"),
  },
  (t) => [unique().on(t.seasonEntryId, t.weekId)],
);

export const makeupDesignation = pgTable("makeup_designation", {
  id: serial("id").primaryKey(),
  seasonEntryId: integer("season_entry_id")
    .notNull()
    .references(() => seasonEntry.id),
  gameId: integer("game_id")
    .notNull()
    .references(() => game.id),
  designatedInWeek: integer("designated_in_week")
    .notNull()
    .references(() => week.id),
  countsTowardWeek: integer("counts_toward_week")
    .notNull()
    .references(() => week.id),
});

export const ruling = pgTable("ruling", {
  id: serial("id").primaryKey(),
  weekId: integer("week_id")
    .notNull()
    .references(() => week.id),
  seasonEntryId: integer("season_entry_id").references(() => seasonEntry.id),
  type: text("type").notNull(),
  description: text("description"),
  appliedBy: integer("applied_by")
    .notNull()
    .references(() => player.id),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const weekResult = pgTable(
  "week_result",
  {
    id: serial("id").primaryKey(),
    seasonEntryId: integer("season_entry_id")
      .notNull()
      .references(() => seasonEntry.id),
    weekId: integer("week_id")
      .notNull()
      .references(() => week.id),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    pushes: integer("pushes").notNull().default(0),
    rateAppliedCents: integer("rate_applied_cents").notNull(),
    grossLossCents: integer("gross_loss_cents").notNull(),
    weeklyWinShareCents: integer("weekly_win_share_cents")
      .notNull()
      .default(0),
    denzilAwardCents: integer("denzil_award_cents").notNull().default(0),
    rankAfterWeek: integer("rank_after_week"),
  },
  (t) => [unique().on(t.seasonEntryId, t.weekId)],
);
