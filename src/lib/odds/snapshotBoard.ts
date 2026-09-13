import { eq } from "drizzle-orm";
import { db } from "../../db";
import { upsertOddsApiGame } from "../../db/games";
import type { Sport } from "../../db/teams";
import { week } from "../../db/schema";
import { fetchBoard } from "./fetchBoard";

const SNAPSHOT_SPORTS: Sport[] = ["NFL", "NCAA"];

export type SnapshotResult = {
  weekId: number;
  candidatesFetched: number;
  candidatesPersisted: number;
  gamesCreated: number;
  gamesUpdated: number;
};

/**
 * The candidate pool, not the published board. Every persisted row is
 * written with isOnBoard = false; the commissioner's rules (see
 * src/lib/board) decide what's actually on the board, evaluated at
 * read/publish time, not at ingest time — so this snapshot captures
 * everything available and never has to be re-fetched just because a
 * rule changed.
 *
 * Always fetches both NFL and NCAA — deriving this from saved rules
 * was circular (rules can't be written against games that don't exist
 * yet), and two API calls a week costs nothing against the quota.
 */
export async function takeSnapshot(weekId: number): Promise<SnapshotResult> {
  const [weekRow] = await db
    .select()
    .from(week)
    .where(eq(week.id, weekId))
    .limit(1);

  if (!weekRow) {
    throw new Error(`No week found for id ${weekId}`);
  }

  let candidatesFetched = 0;
  let candidatesPersisted = 0;
  let gamesCreated = 0;
  let gamesUpdated = 0;

  for (const sport of SNAPSHOT_SPORTS) {
    // startsAt/endsAt is the game-eligibility window, not "now + N days" —
    // this is what makes a re-run reproduce the same board and lets an
    // old week be backfilled.
    const { candidates } = await fetchBoard(
      sport,
      weekRow.startsAt,
      weekRow.endsAt,
    );
    candidatesFetched += candidates.length;

    for (const candidate of candidates) {
      const { created } = await upsertOddsApiGame({
        weekId,
        sport: candidate.sport,
        homeTeamId: candidate.homeTeamId,
        awayTeamId: candidate.awayTeamId,
        kickoffAt: candidate.kickoffAt,
        market: candidate.market,
        favoriteTeamId: candidate.favoriteTeamId,
        spread: candidate.spread,
        totalPoints: candidate.totalPoints,
        externalEventId: candidate.externalEventId,
        sourceBook: candidate.sourceBook,
      });

      candidatesPersisted++;
      if (created) gamesCreated++;
      else gamesUpdated++;
    }
  }

  await db
    .update(week)
    .set({ lineSnapshotAt: new Date() })
    .where(eq(week.id, weekId));

  return {
    weekId,
    candidatesFetched,
    candidatesPersisted,
    gamesCreated,
    gamesUpdated,
  };
}
