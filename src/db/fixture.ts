import { eq, inArray, like } from "drizzle-orm";
import { db } from "./index";
import {
  game,
  pick,
  player,
  season,
  seasonEntry,
  submission,
  team,
  week,
  weekBoardConfig,
} from "./schema";

// Shared identity for the Phase D test fixture (scripts/seed-fixture.ts).
// Every row the fixture creates is reachable from one of these three
// markers, so cleanup never has to guess what belongs to it: the season
// row itself, player.rollupKey (fixture players own this whole prefix,
// no real player ever will), and team.canonicalName (same reasoning).
export const FIXTURE_SEASON_LABEL = "Fixture Season — Phase D Test";
export const FIXTURE_ROLLUP_PREFIX = "FIXTURE-P";
export const FIXTURE_TEAM_PREFIX = "Fixture ";

/**
 * Deletes the fixture season and everything under it, in FK-safe order.
 * A no-op (with a log line) if the fixture was never seeded. Shared by
 * seed-fixture.ts (which calls this first, so re-running is idempotent)
 * and seed-fixture-reset.ts (pure cleanup, no reseed).
 *
 * Note: fixture games are written with source = 'manual' (the schema's
 * check constraint requires that for any game without an
 * externalEventId). The existing `npm run seed:reset` also targets
 * source = 'manual' games — running it after the fixture is seeded will
 * hit a foreign-key error on the fixture's picks rather than silently
 * corrupting anything, but it's not the tool for fixture cleanup. Use
 * seed:fixture:reset instead.
 */
export async function deleteFixtureSeason(): Promise<void> {
  const [seasonRow] = await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.label, FIXTURE_SEASON_LABEL))
    .limit(1);

  if (!seasonRow) {
    console.log("no fixture season found — nothing to clean up");
  } else {
    const weekRows = await db
      .select({ id: week.id })
      .from(week)
      .where(eq(week.seasonId, seasonRow.id));
    const weekIds = weekRows.map((w) => w.id);

    if (weekIds.length > 0) {
      await db.delete(pick).where(inArray(pick.weekId, weekIds));
      await db.delete(submission).where(inArray(submission.weekId, weekIds));
      await db
        .delete(weekBoardConfig)
        .where(inArray(weekBoardConfig.weekId, weekIds));
      await db.delete(game).where(inArray(game.weekId, weekIds));
      await db.delete(week).where(inArray(week.id, weekIds));
    }

    await db.delete(seasonEntry).where(eq(seasonEntry.seasonId, seasonRow.id));
    await db.delete(season).where(eq(season.id, seasonRow.id));
    console.log(
      `deleted fixture season ${seasonRow.id}: ${weekIds.length} weeks and everything under them`,
    );
  }

  const deletedPlayers = await db
    .delete(player)
    .where(like(player.rollupKey, `${FIXTURE_ROLLUP_PREFIX}%`))
    .returning({ id: player.id });
  console.log(`deleted ${deletedPlayers.length} fixture player(s)`);

  const deletedTeams = await db
    .delete(team)
    .where(like(team.canonicalName, `${FIXTURE_TEAM_PREFIX}%`))
    .returning({ id: team.id });
  console.log(`deleted ${deletedTeams.length} fixture team(s)`);
}
