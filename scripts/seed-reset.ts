import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../src/db";
import { FIXTURE_SEASON_LABEL } from "../src/db/fixture";
import { game, season, team, teamAlias, week } from "../src/db/schema";

/**
 * Cleans up test/dev board state so a snapshot + curation cycle can be
 * re-run from a known baseline:
 *   1. Deletes manual games (source = 'manual') and any team created
 *      specifically for one (team_alias.source = 'manual') that no
 *      remaining game still references.
 *   2. Resets isOnBoard to false on every game and linesPublishedAt to
 *      null on every week.
 * Leaves odds-api-sourced games and teams untouched — this is a reset
 * of curation/manual-entry state, not the snapshot pool itself.
 *
 * Scoped by seasonId to exclude the Phase D fixture season (see
 * src/db/fixture.ts): the fixture's games are also source = 'manual'
 * (required by the schema's check constraint whenever externalEventId
 * is null), but they carry real picks, so deleting them FK-errors.
 * Fixture cleanup has its own tool — npm run seed:fixture:reset.
 */
async function main() {
  const [fixtureSeason] = await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.label, FIXTURE_SEASON_LABEL))
    .limit(1);

  let fixtureWeekIds: number[] = [];
  if (fixtureSeason) {
    const fixtureWeeks = await db
      .select({ id: week.id })
      .from(week)
      .where(eq(week.seasonId, fixtureSeason.id));
    fixtureWeekIds = fixtureWeeks.map((w) => w.id);
    console.log(
      `excluding fixture season ${fixtureSeason.id} (${fixtureWeekIds.length} weeks) from reset`,
    );
  }

  const manualGamesWhere = fixtureWeekIds.length > 0
    ? and(eq(game.source, "manual"), notInArray(game.weekId, fixtureWeekIds))
    : eq(game.source, "manual");

  const manualGames = await db
    .select({
      id: game.id,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      favoriteTeamId: game.favoriteTeamId,
    })
    .from(game)
    .where(manualGamesWhere);

  if (manualGames.length > 0) {
    await db.delete(game).where(
      inArray(
        game.id,
        manualGames.map((g) => g.id),
      ),
    );
    console.log(`deleted ${manualGames.length} manual game(s)`);
  } else {
    console.log("no manual games to delete");
  }

  const manualAliasRows = await db
    .select({ teamId: teamAlias.teamId })
    .from(teamAlias)
    .where(eq(teamAlias.source, "manual"));

  let teamsDeleted = 0;
  if (manualAliasRows.length > 0) {
    const remainingGames = await db
      .select({
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        favoriteTeamId: game.favoriteTeamId,
      })
      .from(game);

    const stillReferenced = new Set<number>();
    for (const g of remainingGames) {
      stillReferenced.add(g.homeTeamId);
      stillReferenced.add(g.awayTeamId);
      if (g.favoriteTeamId !== null) stillReferenced.add(g.favoriteTeamId);
    }

    const teamIdsToDelete = [
      ...new Set(manualAliasRows.map((r) => r.teamId)),
    ].filter((id) => !stillReferenced.has(id));

    if (teamIdsToDelete.length > 0) {
      await db
        .delete(teamAlias)
        .where(inArray(teamAlias.teamId, teamIdsToDelete));
      await db.delete(team).where(inArray(team.id, teamIdsToDelete));
      teamsDeleted = teamIdsToDelete.length;
    }
  }
  console.log(`deleted ${teamsDeleted} manual team(s) and their alias(es)`);

  await db
    .update(game)
    .set({ isOnBoard: false })
    .where(fixtureWeekIds.length > 0 ? notInArray(game.weekId, fixtureWeekIds) : undefined);
  await db
    .update(week)
    .set({ linesPublishedAt: null })
    .where(fixtureWeekIds.length > 0 ? notInArray(week.id, fixtureWeekIds) : undefined);
  console.log(
    "reset isOnBoard=false and linesPublishedAt=null on all non-fixture games/weeks",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
