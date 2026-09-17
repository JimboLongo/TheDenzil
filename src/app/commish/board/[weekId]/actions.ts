"use server";

import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { createManualGame } from "@/db/games";
import { boardOverride, game, ruling, team, week, weekBoardConfig } from "@/db/schema";
import type { Sport } from "@/db/teams";
import { requireCommish } from "@/lib/auth/getCurrentPlayer";
import { computeBoard } from "@/lib/board/computeBoard";
import { publishWeek } from "@/lib/board/publishWeek";
import type { BoardRule, Market, OverrideAction } from "@/lib/board/rules";
import { ingestSchedule } from "@/lib/odds/ingestSchedule";
import { takeSnapshot } from "@/lib/odds/snapshotBoard";

// Every action here re-checks requireCommish() even though Proxy already
// gates /commish/* — Proxy coverage can silently disappear from a route
// (matcher edit, a Server Function moved elsewhere), and Server Functions
// are POST endpoints reachable directly regardless of what the UI shows.

const ALL_SPORTS: Sport[] = ["NFL", "NCAA", "CFL"];
const ALL_MARKETS: Market[] = ["SPREAD", "TOTAL"];

// One rule per (sport, market) — a market is "on" purely by having a
// non-empty day set, no separate checkbox. Include/exclude team lists
// stay scoped per sport (shared by both its markets).
function parseRulesFromFormData(formData: FormData): BoardRule[] {
  const rules: BoardRule[] = [];

  for (const sport of ALL_SPORTS) {
    const hasIncludeList = Boolean(formData.get(`rule_${sport}_hasInclude`));
    const includeTeamIds = hasIncludeList
      ? formData.getAll(`rule_${sport}_includeTeamIds`).map((v) => Number(v))
      : null;

    const hasExcludeList = Boolean(formData.get(`rule_${sport}_hasExclude`));
    const excludeTeamIds = hasExcludeList
      ? formData.getAll(`rule_${sport}_excludeTeamIds`).map((v) => Number(v))
      : null;

    for (const market of ALL_MARKETS) {
      const daysOfWeek: number[] = [];
      for (let d = 0; d < 7; d++) {
        if (formData.get(`rule_${sport}_${market}_day_${d}`)) daysOfWeek.push(d);
      }
      if (daysOfWeek.length === 0) continue;

      rules.push({ sport, market, daysOfWeek, includeTeamIds, excludeTeamIds });
    }
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

  // Publish always operates on the rules currently shown in the editor
  // (saved here first), so the frozen board matches the live preview the
  // commissioner just looked at. The guards themselves live in
  // publishWeek(), shared with the publish cron.
  const [weekRow] = await db
    .select({ linesPublishedAt: week.linesPublishedAt })
    .from(week)
    .where(eq(week.id, weekId))
    .limit(1);

  if (weekRow && !weekRow.linesPublishedAt) {
    await saveRules(weekId, parseRulesFromFormData(formData));
  }

  const outcome = await publishWeek(weekId);
  revalidatePath(`/commish/board/${weekId}`);

  return outcome.ok ? { ok: true, message: null } : { ok: false, message: outcome.message };
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

// ---------------------------------------------------------------------
// Board builder: week switching, schedule, override clearing
// ---------------------------------------------------------------------
export type BoardGameRow = {
  id: number;
  sport: Sport;
  market: Market;
  kickoffAt: Date;
  spread: string | null;
  totalPoints: string | null;
  homeName: string;
  awayName: string;
  favoriteIsHome: boolean;
  /** What the rules + overrides currently say. */
  included: boolean;
  /** Set when this game's state comes from an override rather than the rules. */
  override: OverrideAction | null;
  /** What was frozen onto the game row at publish time. */
  isOnBoard: boolean;
  /** No line yet — schedule-ingested but not snapshotted. Shows as TBD. */
  unpriced: boolean;
};

export type WeekBoardData = {
  weekId: number;
  number: number;
  type: string;
  status: string;
  linesPublishedAt: Date | null;
  lineSnapshotAt: Date | null;
  snapshotTakenAt: Date | null;
  publishAt: Date | null;
  rules: BoardRule[];
  games: BoardGameRow[];
};

export async function loadWeekBoardAction(weekId: number): Promise<WeekBoardData> {
  await requireCommish();
  return loadWeekBoard(weekId);
}

/** Shared by the action and the page's initial server render. */
export async function loadWeekBoard(weekId: number): Promise<WeekBoardData> {
  const [weekRow] = await db.select().from(week).where(eq(week.id, weekId)).limit(1);
  if (!weekRow) throw new Error(`Week ${weekId} not found`);

  const homeTeam = alias(team, "home_team");
  const awayTeam = alias(team, "away_team");

  const rows = await db
    .select({
      id: game.id,
      sport: game.sport,
      market: game.market,
      kickoffAt: game.kickoffAt,
      spread: game.spread,
      totalPoints: game.totalPoints,
      homeTeamId: game.homeTeamId,
      favoriteTeamId: game.favoriteTeamId,
      isOnBoard: game.isOnBoard,
      homeName: homeTeam.canonicalName,
      awayName: awayTeam.canonicalName,
    })
    .from(game)
    .innerJoin(homeTeam, eq(game.homeTeamId, homeTeam.id))
    .innerJoin(awayTeam, eq(game.awayTeamId, awayTeam.id))
    .where(eq(game.weekId, weekId))
    .orderBy(asc(game.kickoffAt), asc(game.id));

  const [config] = await db
    .select()
    .from(weekBoardConfig)
    .where(eq(weekBoardConfig.weekId, weekId))
    .limit(1);

  const overrideRows = await db
    .select()
    .from(boardOverride)
    .where(eq(boardOverride.weekId, weekId));
  const overrides = new Map(overrideRows.map((o) => [o.gameId, o.action]));

  const includedIds = new Set(await computeBoard(weekId));

  return {
    weekId,
    number: weekRow.number,
    type: weekRow.type,
    status: weekRow.status,
    linesPublishedAt: weekRow.linesPublishedAt,
    lineSnapshotAt: weekRow.lineSnapshotAt,
    snapshotTakenAt: weekRow.snapshotTakenAt,
    publishAt: weekRow.publishAt,
    rules: (config?.rules as BoardRule[] | undefined) ?? [],
    games: rows.map((r) => ({
      id: r.id,
      sport: r.sport,
      market: r.market,
      kickoffAt: r.kickoffAt,
      spread: r.spread,
      totalPoints: r.totalPoints,
      homeName: r.homeName,
      awayName: r.awayName,
      favoriteIsHome: r.favoriteTeamId === r.homeTeamId,
      included: includedIds.has(r.id),
      override: overrides.get(r.id) ?? null,
      isOnBoard: r.isOnBoard,
      unpriced: r.market === "SPREAD" ? r.spread === null : r.totalPoints === null,
    })),
  };
}

export type ScheduleResult = { ok: boolean; message: string };

/** Per-week schedule. Empty string clears a field back to unset. */
export async function saveScheduleAction(
  weekId: number,
  lineSnapshotAtRaw: string,
  publishAtRaw: string,
): Promise<ScheduleResult> {
  await requireCommish();

  const parse = (raw: string, label: string): Date | null | { error: string } => {
    if (!raw.trim()) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? { error: `${label} is not a valid date.` } : d;
  };

  const snapshotAt = parse(lineSnapshotAtRaw, "Line snapshot");
  if (snapshotAt && "error" in snapshotAt) return { ok: false, message: snapshotAt.error };
  const publishAt = parse(publishAtRaw, "Publish");
  if (publishAt && "error" in publishAt) return { ok: false, message: publishAt.error };

  await db
    .update(week)
    .set({ lineSnapshotAt: snapshotAt, publishAt })
    .where(eq(week.id, weekId));

  revalidatePath(`/commish/board/${weekId}`);
  return { ok: true, message: "Schedule saved." };
}

/** Drops an override so the game goes back to whatever the rules say. */
export async function clearOverrideAction(weekId: number, gameId: number) {
  const current = await requireCommish();

  await db
    .delete(boardOverride)
    .where(and(eq(boardOverride.weekId, weekId), eq(boardOverride.gameId, gameId)));

  const [weekRow] = await db
    .select({ linesPublishedAt: week.linesPublishedAt })
    .from(week)
    .where(eq(week.id, weekId))
    .limit(1);

  if (weekRow?.linesPublishedAt) {
    // Past publish the frozen board has to be corrected immediately, and
    // that leaves an audit trail like any other post-publish change.
    const included = new Set(await computeBoard(weekId));
    await db.update(game).set({ isOnBoard: included.has(gameId) }).where(eq(game.id, gameId));
    await db.insert(ruling).values({
      weekId,
      type: "board_override_cleared",
      description: `Cleared override on game ${gameId}; board membership back to rules`,
      appliedBy: current.player.id,
    });
  }

  revalidatePath(`/commish/board/${weekId}`);
}

export type RefreshScheduleResult = { ok: boolean; message: string };

/**
 * Manual schedule top-up. Costs no API quota, so it can be run freely —
 * the same ingest the hourly cron performs.
 */
export async function refreshScheduleAction(): Promise<RefreshScheduleResult> {
  await requireCommish();
  try {
    const r = await ingestSchedule();
    return {
      ok: true,
      message: `${r.eventsFetched} scheduled events fetched · ${r.gamesCreated} new game rows · ${r.kickoffsUpdated} kickoff(s) updated${r.skippedNoWeek ? ` · ${r.skippedNoWeek} outside any week window` : ""}.`,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
