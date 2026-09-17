import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { game, team, week } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { computeBoard } from "./computeBoard";

const homeTeamAlias = alias(team, "pw_home");
const awayTeamAlias = alias(team, "pw_away");

export type PublishOutcome =
  | { ok: true; gamesOnBoard: number }
  | { ok: false; reason:
        | "not-found"
        | "already-published"
        | "week-already-open"
        | "empty-board"
        | "unpriced-games"; message: string };

/**
 * The one publish path. Both the commissioner's Publish button and the
 * hourly publish cron go through this, so the one-open-week constraint
 * and the empty-board guard apply identically however a board goes live.
 *
 * Deliberately does not save rules — the UI saves the rules currently in
 * the editor first, so the frozen board matches the preview the
 * commissioner was looking at. The cron publishes whatever rules are
 * already stored.
 */
export async function publishWeek(weekId: number): Promise<PublishOutcome> {
  const [weekRow] = await db
    .select({
      id: week.id,
      number: week.number,
      seasonId: week.seasonId,
      linesPublishedAt: week.linesPublishedAt,
    })
    .from(week)
    .where(eq(week.id, weekId))
    .limit(1);

  if (!weekRow) {
    return { ok: false, reason: "not-found", message: `Week ${weekId} not found.` };
  }

  if (weekRow.linesPublishedAt) {
    return {
      ok: false,
      reason: "already-published",
      message: `Week ${weekRow.number} is already published.`,
    };
  }

  // Mirrors the DB's partial unique index (week_one_open_per_season):
  // two open weeks means players can submit against the wrong one.
  const [otherOpenWeek] = await db
    .select({ number: week.number })
    .from(week)
    .where(and(eq(week.seasonId, weekRow.seasonId), eq(week.status, "open")))
    .limit(1);

  if (otherOpenWeek) {
    return {
      ok: false,
      reason: "week-already-open",
      message: `Week ${otherOpenWeek.number} is already open — close it before opening week ${weekRow.number}.`,
    };
  }

  const includedIds = await computeBoard(weekId);

  if (includedIds.length === 0) {
    // A published board with zero games is a week nobody can submit picks
    // for, and it would be discovered on Saturday morning.
    return {
      ok: false,
      reason: "empty-board",
      message: `Week ${weekRow.number} board is empty — no game matches its rules or overrides.`,
    };
  }

  // A game with no line is one players cannot pick. Catching it here
  // means the commissioner finds out Thursday night, not Saturday
  // morning when nine picks are already due.
  const includedSet = new Set(includedIds);
  const unpricedOnBoard = await db
    .select({
      id: game.id,
      market: game.market,
      spread: game.spread,
      totalPoints: game.totalPoints,
      homeName: homeTeamAlias.canonicalName,
      awayName: awayTeamAlias.canonicalName,
    })
    .from(game)
    .innerJoin(homeTeamAlias, eq(game.homeTeamId, homeTeamAlias.id))
    .innerJoin(awayTeamAlias, eq(game.awayTeamId, awayTeamAlias.id))
    .where(eq(game.weekId, weekId));

  const blocking = unpricedOnBoard.filter(
    (g) =>
      includedSet.has(g.id) &&
      (g.market === "SPREAD" ? g.spread === null : g.totalPoints === null),
  );

  if (blocking.length > 0) {
    const names = blocking
      .map((g) => `${g.awayName} @ ${g.homeName} (${g.market === "SPREAD" ? "spread" : "total"})`)
      .join("; ");
    return {
      ok: false,
      reason: "unpriced-games",
      message: `Week ${weekRow.number} has ${blocking.length} game(s) on the board with no line yet: ${names}. Wait for the snapshot or take these off the board.`,
    };
  }

  const weekGames = await db.select({ id: game.id }).from(game).where(eq(game.weekId, weekId));
  const onIds = weekGames.filter((g) => includedSet.has(g.id)).map((g) => g.id);
  const offIds = weekGames.filter((g) => !includedSet.has(g.id)).map((g) => g.id);

  await db.transaction(async (tx) => {
    if (onIds.length > 0) {
      await tx.update(game).set({ isOnBoard: true }).where(inArray(game.id, onIds));
    }
    if (offIds.length > 0) {
      await tx.update(game).set({ isOnBoard: false }).where(inArray(game.id, offIds));
    }
    await tx
      .update(week)
      .set({ linesPublishedAt: new Date(), status: "open" })
      .where(eq(week.id, weekId));
  });

  return { ok: true, gamesOnBoard: onIds.length };
}
