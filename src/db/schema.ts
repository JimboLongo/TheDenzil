import { sql } from "drizzle-orm";
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
  uniqueIndex,
  check,
  primaryKey,
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
// 'upcoming' -> 'open' (publishBoardAction) -> 'settling' (auto, once
// now > max kickoff of on-board games) -> 'final' (settlement engine,
// Phase D). See getCurrentWeek() in src/db/weeks.ts — never resolved
// by a timestamp heuristic.
export const weekStatusEnum = pgEnum("week_status", [
  "upcoming",
  "open",
  "settling",
  "final",
]);
export const teamAliasSourceEnum = pgEnum("team_alias_source", [
  "archive",
  "odds_api",
  "manual",
]);
export const gameSourceEnum = pgEnum("game_source", ["odds_api", "manual"]);
export const boardOverrideActionEnum = pgEnum("board_override_action", [
  "INCLUDE",
  "EXCLUDE",
]);

// Auth.js (next-auth v5) adapter tables — column names/shapes match
// @auth/drizzle-adapter's expected Postgres schema exactly, so this
// schema can be passed straight into DrizzleAdapter(db, { usersTable:
// user, ... }) while still being managed by drizzle-kit like every
// other table. Deliberately separate from `player`: auth identity and
// league membership are different concerns — see getCurrentPlayer(),
// which resolves a session to a player row by email.
export const user = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const account = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const session = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationToken = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const team = pgTable("team", {
  id: serial("id").primaryKey(),
  sport: sportEnum("sport").notNull(),
  canonicalName: text("canonical_name").notNull(),
  abbreviation: text("abbreviation"),
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

// Season-level board defaults: the /commish/config grid. nflTeamIds /
// ncaaTeamIds are the season-wide team lists (null = all teams,
// default). grid is a BoardGrid (src/lib/board/grid.ts) — 18 weeks x
// {NFL_SPREAD, NFL_TOTAL, NCAA_SPREAD, NCAA_TOTAL}, each a day-of-week
// array, empty meaning not included. Saving the grid writes
// week_board_config rows per week; this table is the durable "plan"
// that survives even for weeks that don't exist yet or are locked.
export const seasonBoardDefaults = pgTable("season_board_defaults", {
  seasonId: integer("season_id")
    .primaryKey()
    .references(() => season.id),
  nflTeamIds: integer("nfl_team_ids").array(),
  ncaaTeamIds: integer("ncaa_team_ids").array(),
  grid: jsonb("grid").notNull().default(sql`'{}'::jsonb`),
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

export const week = pgTable(
  "week",
  {
    id: serial("id").primaryKey(),
    seasonId: integer("season_id")
      .notNull()
      .references(() => season.id),
    number: integer("number").notNull(),
    type: weekTypeEnum("type").notNull(),
    status: weekStatusEnum("status").notNull().default("upcoming"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    linesPublishedAt: timestamp("lines_published_at", { withTimezone: true }),
    lineSnapshotAt: timestamp("line_snapshot_at", { withTimezone: true }),
    isSpeedWeekForAll: boolean("is_speed_week_for_all")
      .notNull()
      .default(false),
    allowsStringBetsFromWeek: integer("allows_string_bets_from_week"),
  },
  (t) => [
    // Two open weeks means players can submit against the wrong one —
    // enforced here, not just in the app, since this must hold no
    // matter what code path writes the row.
    uniqueIndex("week_one_open_per_season")
      .on(t.seasonId)
      .where(sql`${t.status} = 'open'`),
  ],
);

// Board rule shape (documented here since jsonb carries no DB-level schema):
//   { sport: 'NFL'|'NCAA'|'CFL', market: 'SPREAD'|'TOTAL',
//     daysOfWeek: number[] (0=Sun..6=Sat, America/New_York),
//     includeTeamIds: number[] | null, excludeTeamIds: number[] | null }
//   One rule per (sport, market) — the same sport's two markets can run
//   on different days in the same week (rule 11). includeTeamIds/
//   excludeTeamIds match on EITHER team, not both; null means no
//   restriction. Exclude wins over include. See src/lib/board/rules.ts
//   for the matching logic and TS types.
export const weekBoardConfig = pgTable("week_board_config", {
  weekId: integer("week_id")
    .primaryKey()
    .references(() => week.id),
  rules: jsonb("rules").notNull().default(sql`'[]'::jsonb`),
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
    source: gameSourceEnum("source").notNull().default("odds_api"),
    externalEventId: text("external_event_id"),
    sourceBook: text("source_book"),
    isOnBoard: boolean("is_on_board").notNull().default(false),
  },
  (t) => [
    unique().on(t.externalEventId, t.market),
    check(
      "game_external_event_id_source_check",
      sql`(source = 'manual' AND external_event_id IS NULL) OR (source = 'odds_api' AND external_event_id IS NOT NULL)`,
    ),
  ],
);

export const boardOverride = pgTable(
  "board_override",
  {
    id: serial("id").primaryKey(),
    weekId: integer("week_id")
      .notNull()
      .references(() => week.id),
    gameId: integer("game_id")
      .notNull()
      .references(() => game.id),
    action: boardOverrideActionEnum("action").notNull(),
    note: text("note"),
  },
  (t) => [unique().on(t.weekId, t.gameId)],
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
