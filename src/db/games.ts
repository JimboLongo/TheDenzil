import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { game } from "./schema";
import { resolveTeam, type Sport } from "./teams";

type Market = "SPREAD" | "TOTAL";

export type UpsertOddsApiGameInput = {
  weekId: number;
  sport: Sport;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
  market: Market;
  favoriteTeamId: number | null;
  spread: number | null;
  totalPoints: number | null;
  externalEventId: string;
  sourceBook: string;
};

export type UpsertGameResult = {
  id: number;
  created: boolean;
};

/**
 * Upserts a game row sourced from the odds API, keyed on
 * (externalEventId, market) — one event with both markets is two rows.
 * Always writes isOnBoard = false; only the commissioner's curation
 * step flips a game onto the published board.
 */
export async function upsertOddsApiGame(
  input: UpsertOddsApiGameInput,
): Promise<UpsertGameResult> {
  const [existing] = await db
    .select({ id: game.id })
    .from(game)
    .where(
      and(
        eq(game.externalEventId, input.externalEventId),
        eq(game.market, input.market),
      ),
    )
    .limit(1);

  const values = {
    weekId: input.weekId,
    sport: input.sport,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    kickoffAt: input.kickoffAt,
    market: input.market,
    favoriteTeamId: input.favoriteTeamId,
    spread: input.spread !== null ? String(input.spread) : null,
    totalPoints: input.totalPoints !== null ? String(input.totalPoints) : null,
    source: "odds_api" as const,
    externalEventId: input.externalEventId,
    sourceBook: input.sourceBook,
    isOnBoard: false,
  };

  if (existing) {
    await db.update(game).set(values).where(eq(game.id, existing.id));
    return { id: existing.id, created: false };
  }

  const [inserted] = await db
    .insert(game)
    .values(values)
    .returning({ id: game.id });

  return { id: inserted.id, created: true };
}

export type CreateManualGameInput = {
  weekId: number;
  sport: Sport;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: Date;
  market: Market;
  favoriteTeamName?: string | null;
  spread?: number | null;
  totalPoints?: number | null;
};

/**
 * Manual entry for games the odds API never posted a line for (bowl
 * games, low-tier matchups). Resolves team names through the same
 * resolveTeam() path as the odds ingest, so a commissioner typing
 * "Georgia Bulldogs" reuses the existing team row instead of minting
 * a duplicate.
 */
export async function createManualGame(
  input: CreateManualGameInput,
): Promise<{ id: number }> {
  const home = await resolveTeam(input.homeTeamName, input.sport, "manual");
  const away = await resolveTeam(input.awayTeamName, input.sport, "manual");

  let favoriteTeamId: number | null = null;
  if (input.favoriteTeamName) {
    const favorite = await resolveTeam(
      input.favoriteTeamName,
      input.sport,
      "manual",
    );
    favoriteTeamId = favorite.teamId;
  }

  const [inserted] = await db
    .insert(game)
    .values({
      weekId: input.weekId,
      sport: input.sport,
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      kickoffAt: input.kickoffAt,
      market: input.market,
      favoriteTeamId,
      spread: input.spread != null ? String(input.spread) : null,
      totalPoints:
        input.totalPoints != null ? String(input.totalPoints) : null,
      source: "manual",
      externalEventId: null,
      sourceBook: null,
      isOnBoard: false,
    })
    .returning({ id: game.id });

  return { id: inserted.id };
}
