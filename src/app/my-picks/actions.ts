"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { pick, submission, week, weekResult } from "@/db/schema";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";

export type DeleteSubmissionResult = { ok: boolean; message: string };

/**
 * DEVELOPMENT ONLY — deletes the caller's own submission for a week so the
 * pick flow can be retested.
 *
 * Submissions are one-shot by rule (spec section 3, "Rolling lock"). A
 * player who can delete and resubmit can wait for Saturday's results and
 * then re-pick, which breaks the entire game. This must never be reachable
 * on the live site.
 *
 * The guard lives here rather than only on the page because a Server
 * Action is a real HTTP endpoint: it can be invoked directly by anyone who
 * knows its id, whether or not any UI renders a button for it. Hiding the
 * button is not a control.
 *
 * Once the league is real, a bad slip is fixed through the commissioner
 * override path, which writes a `ruling` row and leaves an audit trail.
 * This deliberately does not.
 */
export async function deleteSubmissionAction(
  weekId: number,
): Promise<DeleteSubmissionResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "deleteSubmissionAction is disabled in production. Submissions are one-shot; " +
        "use the commissioner override, which writes a ruling row.",
    );
  }

  const current = await getCurrentPlayer();
  if (!current?.seasonEntry) {
    return { ok: false, message: "You're not entered in the active season." };
  }
  const { seasonEntry } = current;

  // Scoped to the caller's own entry, and never takes an entry id from the
  // client — even in development this can only delete your own slip.
  const [weekRow] = await db.select().from(week).where(eq(week.id, weekId)).limit(1);
  if (!weekRow || weekRow.seasonId !== seasonEntry.seasonId) {
    return { ok: false, message: "Week not found." };
  }

  const [existing] = await db
    .select({ id: submission.id, isSpeedDeclared: submission.isSpeedDeclared })
    .from(submission)
    .where(
      and(eq(submission.seasonEntryId, seasonEntry.id), eq(submission.weekId, weekId)),
    )
    .limit(1);

  if (!existing) {
    return { ok: false, message: "No submission to delete for that week." };
  }

  const scope = (table: typeof pick | typeof submission | typeof weekResult) =>
    and(eq(table.seasonEntryId, seasonEntry.id), eq(table.weekId, weekId));

  await db.transaction(async (tx) => {
    await tx.delete(pick).where(scope(pick));
    // week_result is a derived cache; leaving a settled row behind would
    // report dollars for a slip that no longer exists.
    await tx.delete(weekResult).where(scope(weekResult));
    await tx.delete(submission).where(scope(submission));
  });

  revalidatePath("/my-picks");
  revalidatePath("/picks");
  revalidatePath("/weekly-results");
  revalidatePath("/league-picks");
  revalidatePath("/");

  // Speed availability is derived, not stored: "have I used my speed week"
  // is a query for a submission with isSpeedDeclared = true across the
  // season. Deleting the row is what releases the declaration — there is no
  // separate flag to reset.
  return {
    ok: true,
    message: existing.isSpeedDeclared
      ? `Week ${weekRow.number} submission deleted. That slip carried your speed declaration, so it's available again.`
      : `Week ${weekRow.number} submission deleted.`,
  };
}
