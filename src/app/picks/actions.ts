"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { game, pick, submission, week } from "@/db/schema";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";

export type PickSelection = "HOME" | "AWAY" | "OVER" | "UNDER";

export type PickInput = {
  gameId: number;
  selection: PickSelection;
};

export type SubmitPicksResult = { ok: boolean; message: string };

const REQUIRED_PICK_COUNT = 9;
const SPEED_ELIGIBLE_MAX_WEEK = 11;

/**
 * Every check here is re-derived from the DB, not trusted from the
 * client — the client's job is UX (disable the wrong buttons), this
 * function's job is correctness. The two DB unique constraints
 * (submission per season_entry+week, pick per season_entry+week+game)
 * are the final backstop against a race between the pre-checks below
 * and the actual insert.
 */
export async function submitPicksAction(
  weekId: number,
  picks: PickInput[],
  isSpeedDeclared: boolean,
): Promise<SubmitPicksResult> {
  const current = await getCurrentPlayer();
  if (!current || !current.seasonEntry) {
    return { ok: false, message: "You're not entered in the active season." };
  }
  const { seasonEntry } = current;

  const [weekRow] = await db.select().from(week).where(eq(week.id, weekId)).limit(1);
  if (!weekRow || weekRow.seasonId !== seasonEntry.seasonId) {
    return { ok: false, message: "Week not found." };
  }
  if (weekRow.status !== "open") {
    return { ok: false, message: "This week isn't open for picks." };
  }

  if (picks.length !== REQUIRED_PICK_COUNT) {
    return {
      ok: false,
      message: `Exactly ${REQUIRED_PICK_COUNT} picks are required — you sent ${picks.length}.`,
    };
  }

  const gameIds = picks.map((p) => p.gameId);
  if (new Set(gameIds).size !== gameIds.length) {
    return { ok: false, message: "Two picks landed on the same game — not allowed." };
  }

  const [existingSubmission] = await db
    .select({ id: submission.id })
    .from(submission)
    .where(
      and(eq(submission.seasonEntryId, seasonEntry.id), eq(submission.weekId, weekId)),
    )
    .limit(1);
  if (existingSubmission) {
    return { ok: false, message: "You've already submitted picks for this week." };
  }

  const games = await db
    .select()
    .from(game)
    .where(
      and(
        inArray(game.id, gameIds),
        eq(game.weekId, weekId),
        eq(game.isOnBoard, true),
      ),
    );

  if (games.length !== gameIds.length) {
    return {
      ok: false,
      message: "One or more selected games are no longer on the board.",
    };
  }

  const gameById = new Map(games.map((g) => [g.id, g]));
  const now = new Date();

  for (const p of picks) {
    const g = gameById.get(p.gameId);
    if (!g) {
      return { ok: false, message: "One or more selected games are invalid." };
    }
    if (g.kickoffAt <= now) {
      return {
        ok: false,
        message: "Kickoff has already passed for one of your picks.",
      };
    }
    if (g.market === "SPREAD" && p.selection !== "HOME" && p.selection !== "AWAY") {
      return { ok: false, message: "Invalid selection for a spread game." };
    }
    if (g.market === "TOTAL" && p.selection !== "OVER" && p.selection !== "UNDER") {
      return { ok: false, message: "Invalid selection for a total game." };
    }
  }

  const priorSpeedDeclarations = await db
    .select({ id: submission.id })
    .from(submission)
    .innerJoin(week, eq(submission.weekId, week.id))
    .where(
      and(
        eq(submission.seasonEntryId, seasonEntry.id),
        eq(week.seasonId, seasonEntry.seasonId),
        eq(submission.isSpeedDeclared, true),
      ),
    );
  const hasUsedSpeed = priorSpeedDeclarations.length > 0;

  // Rule 8: reaching week 11 without ever declaring forces it, regardless
  // of what the client sent.
  let finalSpeedDeclared = isSpeedDeclared;
  if (weekRow.number === SPEED_ELIGIBLE_MAX_WEEK && !hasUsedSpeed) {
    finalSpeedDeclared = true;
  }

  if (finalSpeedDeclared) {
    if (weekRow.number > SPEED_ELIGIBLE_MAX_WEEK) {
      return {
        ok: false,
        message: "Speed week can only be declared in weeks 1-11.",
      };
    }
    if (hasUsedSpeed) {
      return {
        ok: false,
        message: "You've already declared your speed week this season.",
      };
    }
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(submission).values({
        seasonEntryId: seasonEntry.id,
        weekId,
        isSpeedDeclared: finalSpeedDeclared,
        pickCount: picks.length,
      });

      await tx.insert(pick).values(
        picks.map((p) => {
          const g = gameById.get(p.gameId)!;
          const selectedTeamId =
            p.selection === "HOME"
              ? g.homeTeamId
              : p.selection === "AWAY"
                ? g.awayTeamId
                : null;
          return {
            seasonEntryId: seasonEntry.id,
            weekId,
            gameId: p.gameId,
            selection: p.selection,
            selectedTeamId,
            source: "player" as const,
          };
        }),
      );
    });
  } catch {
    return {
      ok: false,
      message: "Submission failed — you may have already submitted for this week.",
    };
  }

  revalidatePath("/picks");
  revalidatePath("/my-picks");
  revalidatePath("/");

  return { ok: true, message: "Picks submitted." };
}
