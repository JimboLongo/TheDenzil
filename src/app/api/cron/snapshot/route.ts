import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { season, week } from "@/db/schema";
import { rejectUnauthorizedCron } from "@/lib/cron/auth";
import { takeSnapshot } from "@/lib/odds/snapshotBoard";

export const dynamic = "force-dynamic";

/**
 * Hourly. Snapshots any week whose lineSnapshotAt has passed and which
 * hasn't been snapshotted yet.
 *
 * snapshotTakenAt is what makes this idempotent — without it every run
 * after the scheduled time would re-snapshot the same week and keep
 * overwriting frozen lines with whatever the API says now.
 */
export async function GET(request: Request) {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  // Active season only. A completed season, or the Phase D fixture,
  // has weeks with snapshot times long past — without this the job
  // would "catch up" on all of them and burn odds-API quota re-fetching
  // history that is already final.
  const due = await db
    .select({ id: week.id, number: week.number })
    .from(week)
    .innerJoin(season, eq(week.seasonId, season.id))
    .where(
      and(
        eq(season.status, "active"),
        isNotNull(week.lineSnapshotAt),
        lte(week.lineSnapshotAt, new Date()),
        isNull(week.snapshotTakenAt),
      ),
    );

  const results: { week: number; ok: boolean; detail: string }[] = [];

  for (const w of due) {
    try {
      const result = await takeSnapshot(w.id);
      await db.update(week).set({ snapshotTakenAt: new Date() }).where(eq(week.id, w.id));
      const detail = `${result.candidatesPersisted} of ${result.candidatesFetched} candidates persisted (${result.gamesCreated} new, ${result.gamesUpdated} updated)`;
      console.log(`[cron/snapshot] week ${w.number}: ${detail}`);
      results.push({ week: w.number, ok: true, detail });
    } catch (error) {
      // Loud: a week that never got its lines is a week with no board.
      const detail = (error as Error).message;
      console.error(`[cron/snapshot] week ${w.number} FAILED: ${detail}`);
      results.push({ week: w.number, ok: false, detail });
    }
  }

  if (due.length === 0) console.log("[cron/snapshot] no weeks due.");

  return NextResponse.json({ ok: true, due: due.length, results });
}
