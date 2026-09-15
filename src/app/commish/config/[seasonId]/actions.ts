"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { season, seasonBoardDefaults, week, weekBoardConfig } from "@/db/schema";
import { generateSeasonWeeks, type GenerateWeeksResult } from "@/db/weeks";
import { requireCommish } from "@/lib/auth/getCurrentPlayer";
import { rulesForWeek, TOTAL_WEEKS, type BoardGrid } from "@/lib/board/grid";
import {
  addCalendarDays,
  etCalendarDateOf,
  etWallTimeToUtc,
  parseIsoDateOnly,
} from "@/lib/dates";

export type SaveGridInput = {
  nflTeamIds: number[] | null;
  ncaaTeamIds: number[] | null;
  grid: BoardGrid;
};

export type SkippedWeek = { number: number; reason: "locked" | "not-created" };

export type SaveGridResult = {
  ok: boolean;
  message: string;
  skipped: SkippedWeek[];
};

export async function saveGridAction(
  seasonId: number,
  input: SaveGridInput,
): Promise<SaveGridResult> {
  await requireCommish();

  const [seasonRow] = await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.id, seasonId))
    .limit(1);

  if (!seasonRow) {
    return { ok: false, message: "Season not found.", skipped: [] };
  }

  await db
    .insert(seasonBoardDefaults)
    .values({
      seasonId,
      nflTeamIds: input.nflTeamIds,
      ncaaTeamIds: input.ncaaTeamIds,
      grid: input.grid,
    })
    .onConflictDoUpdate({
      target: seasonBoardDefaults.seasonId,
      set: {
        nflTeamIds: input.nflTeamIds,
        ncaaTeamIds: input.ncaaTeamIds,
        grid: input.grid,
      },
    });

  const weeks = await db
    .select({ id: week.id, number: week.number, status: week.status })
    .from(week)
    .where(eq(week.seasonId, seasonId));

  const weekByNumber = new Map(weeks.map((w) => [w.number, w]));
  const skipped: SkippedWeek[] = [];
  let written = 0;

  for (let number = 1; number <= TOTAL_WEEKS; number++) {
    const weekRow = weekByNumber.get(number);

    if (!weekRow) {
      skipped.push({ number, reason: "not-created" });
      continue;
    }

    // A published board must never change because someone edited the
    // season grid — locked weeks are skipped outright, not merged.
    if (weekRow.status !== "upcoming") {
      skipped.push({ number, reason: "locked" });
      continue;
    }

    const rules = rulesForWeek(
      input.grid,
      number,
      input.nflTeamIds,
      input.ncaaTeamIds,
    );

    await db
      .insert(weekBoardConfig)
      .values({ weekId: weekRow.id, rules })
      .onConflictDoUpdate({
        target: weekBoardConfig.weekId,
        set: { rules },
      });

    written++;
    revalidatePath(`/commish/board/${weekRow.id}`);
  }

  revalidatePath(`/commish/config/${seasonId}`);

  return {
    ok: true,
    message:
      skipped.length > 0
        ? `Saved. ${written} week(s) updated, ${skipped.length} skipped.`
        : `Saved. ${written} week(s) updated.`,
    skipped,
  };
}

export async function generateWeeksAction(
  seasonId: number,
  formData: FormData,
): Promise<GenerateWeeksResult> {
  await requireCommish();

  const raw = String(formData.get("firstSaturday") ?? "");
  if (!raw) {
    return { ok: false, message: "First Saturday is required.", created: [], skipped: [] };
  }

  const result = await generateSeasonWeeks(seasonId, parseIsoDateOnly(raw));

  if (result.created.length > 0) {
    revalidatePath(`/commish/config/${seasonId}`);
  }

  return result;
}

export type UpdateWeekTypeResult = { ok: boolean; message: string };

const WEEK_TYPES = ["regular", "thanksgiving", "bowl", "playoff"] as const;
type WeekType = (typeof WEEK_TYPES)[number];

export async function updateWeekTypeAction(
  weekId: number,
  type: WeekType,
): Promise<UpdateWeekTypeResult> {
  await requireCommish();

  if (!WEEK_TYPES.includes(type)) {
    return { ok: false, message: "Invalid week type." };
  }

  const [weekRow] = await db.select().from(week).where(eq(week.id, weekId)).limit(1);
  if (!weekRow) {
    return { ok: false, message: "Week not found." };
  }
  if (weekRow.status !== "upcoming") {
    return { ok: false, message: "Board is published — locked, type can't change." };
  }

  // Rule 3: Wed-Fri games are eligible for thanksgiving/bowl weeks, so
  // the window widens. Anchored off endsAt (always Monday, never
  // widened) rather than the current startsAt, so repeated toggling
  // between types is idempotent instead of drifting further back
  // each time.
  const widensToWednesday = type === "thanksgiving" || type === "bowl";
  let startsAt = weekRow.startsAt;

  if (widensToWednesday) {
    const monday = etCalendarDateOf(weekRow.endsAt);
    const saturday = addCalendarDays(monday, -2);
    const wednesday = addCalendarDays(saturday, -3);
    startsAt = etWallTimeToUtc(wednesday.year, wednesday.month, wednesday.day, 0, 0, 0);
  }

  await db.update(week).set({ type, startsAt }).where(eq(week.id, weekId));

  revalidatePath(`/commish/config/${weekRow.seasonId}`);
  revalidatePath(`/commish/board/${weekId}`);

  return { ok: true, message: `Week ${weekRow.number} set to ${type}.` };
}
