"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { createManualGame } from "@/db/games";
import { boardOverride, game, ruling, week, weekBoardConfig } from "@/db/schema";
import type { Sport } from "@/db/teams";
import { requireCommish } from "@/lib/auth/getCurrentPlayer";
import { computeBoard } from "@/lib/board/computeBoard";
import type { BoardRule, Market, OverrideAction } from "@/lib/board/rules";
import { takeSnapshot } from "@/lib/odds/snapshotBoard";

// Every action here re-checks requireCommish() even though Proxy already
// gates /commish/* — Proxy coverage can silently disappear from a route
// (matcher edit, a Server Function moved elsewhere), and Server Functions
// are POST endpoints reachable directly regardless of what the UI shows.

const ALL_SPORTS: Sport[] = ["NFL", "NCAA", "CFL"];

function parseRulesFromFormData(formData: FormData): BoardRule[] {
  const rules: BoardRule[] = [];

  for (const sport of ALL_SPORTS) {
    const markets: Market[] = [];
    if (formData.get(`rule_${sport}_market_SPREAD`)) markets.push("SPREAD");
    if (formData.get(`rule_${sport}_market_TOTAL`)) markets.push("TOTAL");
    if (markets.length === 0) continue;

    const daysOfWeek: number[] = [];
    for (let d = 0; d < 7; d++) {
      if (formData.get(`rule_${sport}_day_${d}`)) daysOfWeek.push(d);
    }

    const hasIncludeList = Boolean(formData.get(`rule_${sport}_hasInclude`));
    const includeTeamIds = hasIncludeList
      ? formData.getAll(`rule_${sport}_includeTeamIds`).map((v) => Number(v))
      : null;

    const hasExcludeList = Boolean(formData.get(`rule_${sport}_hasExclude`));
    const excludeTeamIds = hasExcludeList
      ? formData.getAll(`rule_${sport}_excludeTeamIds`).map((v) => Number(v))
      : null;

    rules.push({
      sport,
      markets,
      daysOfWeek,
      includeTeamIds,
      excludeTeamIds,
    });
  }

  return rules;
}

async function saveRules(weekId: number, rules: BoardRule[]) {
  await db
    .insert(weekBoardConfig)
    .values({ weekId, rules })
    .onConflictDoUpdate({
      target: weekBoardConfig.weekId,
      set: { rules },
    });
}

export async function saveRulesAction(weekId: number, formData: FormData) {
  await requireCommish();

  const [weekRow] = await db
    .select({ linesPublishedAt: week.linesPublishedAt })
    .from(week)
    .where(eq(week.id, weekId))
    .limit(1);

  // Editing rules does nothing once published — the board is frozen,
  // only overrides can change it.
  if (weekRow?.linesPublishedAt) {
    revalidatePath(`/commish/board/${weekId}`);
    return;
  }

  await saveRules(weekId, parseRulesFromFormData(formData));
  revalidatePath(`/commish/board/${weekId}`);
}

export type PublishResult = { ok: boolean; message: string | null };

export async function publishBoardAction(
  weekId: number,
  formData: FormData,
): Promise<PublishResult> {
  await requireCommish();

  const [weekRow] = await db
    .select({
      linesPublishedAt: week.linesPublishedAt,
      seasonId: week.seasonId,
    })
    .from(week)
    .where(eq(week.id, weekId))
    .limit(1);

  if (!weekRow) {
    return { ok: false, message: "Week not found." };
  }

  if (weekRow.linesPublishedAt) {
    return { ok: false, message: "Board is already published." };
  }

  // App-level guard mirroring the DB's partial unique index
  // (week_one_open_per_season) — two open weeks means players can
  // submit against the wrong one.
  const [otherOpenWeek] = await db
    .select({ id: week.id, number: week.number })
    .from(week)
    .where(and(eq(week.seasonId, weekRow.seasonId), eq(week.status, "open")))
    .limit(1);

  if (otherOpenWeek) {
    return {
      ok: false,
      message: `Week ${otherOpenWeek.number} is already open for this season — close it before opening another.`,
    };
  }

  // Publish always operates on the rules currently shown in the editor
  // (saved here first), so the frozen board matches the live preview
  // the commissioner just looked at.
  await saveRules(weekId, parseRulesFromFormData(formData));

  const includedIds = await computeBoard(weekId);

  if (includedIds.length === 0) {
    // A published board with zero games is a week nobody can submit
    // picks for — and it would be discovered Saturday morning.
    revalidatePath(`/commish/board/${weekId}`);
    return {
      ok: false,
      message:
        "Board is empty — no game matches your rules or overrides. Add a rule, an override, or a manual game before publishing.",
    };
  }

  const includedSet = new Set(includedIds);

  const weekGames = await db
    .select({ id: game.id })
    .from(game)
    .where(eq(game.weekId, weekId));

  const onIds = weekGames.filter((g) => includedSet.has(g.id)).map((g) => g.id);
  const offIds = weekGames.filter((g) => !includedSet.has(g.id)).map((g) => g.id);

  if (onIds.length > 0) {
    await db.update(game).set({ isOnBoard: true }).where(inArray(game.id, onIds));
  }
  if (offIds.length > 0) {
    await db.update(game).set({ isOnBoard: false }).where(inArray(game.id, offIds));
  }

  await db
    .update(week)
    .set({ linesPublishedAt: new Date(), status: "open" })
    .where(eq(week.id, weekId));

  revalidatePath(`/commish/board/${weekId}`);

  return { ok: true, message: null };
}

export async function setOverrideAction(
  weekId: number,
  gameId: number,
  action: OverrideAction,
) {
  const current = await requireCommish();

  await db
    .insert(boardOverride)
    .values({ weekId, gameId, action })
    .onConflictDoUpdate({
      target: [boardOverride.weekId, boardOverride.gameId],
      set: { action },
    });

  const [weekRow] = await db
    .select({ linesPublishedAt: week.linesPublishedAt })
    .from(week)
    .where(eq(week.id, weekId))
    .limit(1);

  if (weekRow?.linesPublishedAt) {
    // Board is frozen — an override past publish applies immediately
    // and must leave an audit trail, since players are already holding
    // picks against the published board.
    await db
      .update(game)
      .set({ isOnBoard: action === "INCLUDE" })
      .where(eq(game.id, gameId));

    await db.insert(ruling).values({
      weekId,
      type: "board_override",
      description: `${action} game ${gameId} on the published board`,
      appliedBy: current.player.id,
    });
  }

  revalidatePath(`/commish/board/${weekId}`);
}

export async function takeSnapshotAction(weekId: number) {
  await requireCommish();
  await takeSnapshot(weekId);
  revalidatePath(`/commish/board/${weekId}`);
}

export async function createManualGameAction(
  weekId: number,
  formData: FormData,
) {
  await requireCommish();

  const sport = String(formData.get("sport")) as Sport;
  const homeTeamName = String(formData.get("homeTeamName") ?? "").trim();
  const awayTeamName = String(formData.get("awayTeamName") ?? "").trim();
  const kickoffAtRaw = String(formData.get("kickoffAt") ?? "");
  const market = String(formData.get("market")) as Market;
  const favoriteTeamName = String(
    formData.get("favoriteTeamName") ?? "",
  ).trim();
  const spreadRaw = formData.get("spread");
  const totalPointsRaw = formData.get("totalPoints");

  if (!homeTeamName || !awayTeamName || !kickoffAtRaw) {
    throw new Error("Home team, away team, and kickoff are required");
  }

  await createManualGame({
    weekId,
    sport,
    homeTeamName,
    awayTeamName,
    // Interpreted in the server's local time zone — the input has no
    // offset. Fine for local/dev use; revisit once this is deployed
    // somewhere that isn't running in ET.
    kickoffAt: new Date(kickoffAtRaw),
    market,
    favoriteTeamName: favoriteTeamName || null,
    spread: spreadRaw ? Number(spreadRaw) : null,
    totalPoints: totalPointsRaw ? Number(totalPointsRaw) : null,
  });

  revalidatePath(`/commish/board/${weekId}`);
}
