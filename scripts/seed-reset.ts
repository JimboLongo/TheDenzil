import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { game, team, teamAlias, week } from "../src/db/schema";

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
 */
async function main() {
  const manualGames = await db
    .select({
      id: game.id,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      favoriteTeamId: game.favoriteTeamId,
    })
    .from(game)
    .where(eq(game.source, "manual"));

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

  await db.update(game).set({ isOnBoard: false });
  await db.update(week).set({ linesPublishedAt: null });
  console.log("reset isOnBoard=false on all games, linesPublishedAt=null on all weeks");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
