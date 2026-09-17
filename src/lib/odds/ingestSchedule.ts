import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { game, season, week } from "@/db/schema";
import { resolveTeam, type Sport } from "@/db/teams";
import type { Market } from "./fetchBoard";

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const SPORT_KEYS: Partial<Record<Sport, string>> = {
  NFL: "americanfootball_nfl",
  NCAA: "americanfootball_ncaaf",
};

const MARKETS: Market[] = ["SPREAD", "TOTAL"];

type OddsApiEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
};

export type IngestScheduleResult = {
  eventsFetched: number;
  gamesCreated: number;
  kickoffsUpdated: number;
  skippedNoWeek: number;
  bySport: Record<string, number>;
};

/**
 * Schedule-only ingest, separate from the odds snapshot.
 *
 * The /events endpoint returns fixtures with no pricing and costs zero
 * quota, so this can run as often as we like. It only reaches about two
 * weeks ahead — roughly the current week and the next — so it is a
 * repeating top-up, not a one-time season load. Weeks beyond that
 * horizon legitimately have no games yet.
 *
 * Critically this NEVER writes spread or totalPoints. An existing row
 * keeps whatever the snapshot froze onto it; running this after a
 * snapshot must not wipe the lines. Only kickoff time is refreshed,
 * since schedules genuinely move.
 *
 * Each event becomes two rows, one per market, both unpriced — that
 * matches how the snapshot stores things and lets it fill the lines in
 * place when it runs.
 */
export async function ingestSchedule(seasonId?: number): Promise<IngestScheduleResult> {
  if (!ODDS_API_KEY) throw new Error("ODDS_API_KEY is not set");

  const targetSeasonId =
    seasonId ??
    (await db.select({ id: season.id }).from(season).where(eq(season.status, "active")).limit(1))[0]
      ?.id;

  if (!targetSeasonId) {
    throw new Error("No active season to ingest a schedule for.");
  }

  const weeks = await db
    .select({ id: week.id, startsAt: week.startsAt, endsAt: week.endsAt })
    .from(week)
    .where(eq(week.seasonId, targetSeasonId));

  const result: IngestScheduleResult = {
    eventsFetched: 0,
    gamesCreated: 0,
    kickoffsUpdated: 0,
    skippedNoWeek: 0,
    bySport: {},
  };

  for (const [sport, sportKey] of Object.entries(SPORT_KEYS) as [Sport, string][]) {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sportKey}/events/?apiKey=${ODDS_API_KEY}`,
    );
    if (!res.ok) {
      throw new Error(`/events failed for ${sport}: ${res.status} ${await res.text()}`);
    }

    const events = (await res.json()) as OddsApiEvent[];
    result.eventsFetched += events.length;
    result.bySport[sport] = events.length;

    for (const event of events) {
      const kickoffAt = new Date(event.commence_time);

      // The API has no concept of our week numbering, so an event belongs
      // to whichever week's window contains its kickoff.
      const weekRow = weeks.find((w) => kickoffAt >= w.startsAt && kickoffAt <= w.endsAt);
      if (!weekRow) {
        result.skippedNoWeek++;
        continue;
      }

      const home = await resolveTeam(event.home_team, sport);
      const away = await resolveTeam(event.away_team, sport);

      for (const market of MARKETS) {
        const [existing] = await db
          .select({ id: game.id, kickoffAt: game.kickoffAt })
          .from(game)
          .where(and(eq(game.externalEventId, event.id), eq(game.market, market)))
          .limit(1);

        if (existing) {
          // Refresh the kickoff if it moved, but never touch pricing.
          if (existing.kickoffAt.getTime() !== kickoffAt.getTime()) {
            await db.update(game).set({ kickoffAt }).where(eq(game.id, existing.id));
            result.kickoffsUpdated++;
          }
          continue;
        }

        await db.insert(game).values({
          weekId: weekRow.id,
          sport,
          homeTeamId: home.teamId,
          awayTeamId: away.teamId,
          kickoffAt,
          market,
          favoriteTeamId: null,
          spread: null,
          totalPoints: null,
          status: "scheduled",
          source: "odds_api",
          externalEventId: event.id,
          sourceBook: null,
          isOnBoard: false,
        });
        result.gamesCreated++;
      }
    }
  }

  return result;
}

/** A game the players could not possibly pick: no line on it yet. */
export function isUnpriced(g: { market: string; spread: string | null; totalPoints: string | null }) {
  return g.market === "SPREAD" ? g.spread === null : g.totalPoints === null;
}
