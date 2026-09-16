import { and, eq, isNotNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { season, week } from "@/db/schema";
import { publishWeek } from "@/lib/board/publishWeek";
import { rejectUnauthorizedCron } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

/**
 * Hourly. Publishes any week whose publishAt has passed and which is
 * still 'upcoming'.
 *
 * Goes through publishWeek(), the same path the commissioner's Publish
 * button uses, so the one-open-week constraint and the empty-board guard
 * apply identically to an automatic publish.
 *
 * A blocked publish leaves the week upcoming and is logged as an error
 * rather than swallowed — a board that quietly failed to go live is the
 * thing the commissioner most needs to hear about, and the Board Builder
 * also flags an overdue week in the UI.
 */
export async function GET(request: Request) {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  // Active season only — see the snapshot job for why.
  const due = await db
    .select({ id: week.id, number: week.number })
    .from(week)
    .innerJoin(season, eq(week.seasonId, season.id))
    .where(
      and(
        eq(season.status, "active"),
        isNotNull(week.publishAt),
        lte(week.publishAt, new Date()),
        eq(week.status, "upcoming"),
      ),
    );

  const results: { week: number; ok: boolean; reason?: string; detail: string }[] = [];

  for (const w of due) {
    const outcome = await publishWeek(w.id);

    if (outcome.ok) {
      const detail = `published with ${outcome.gamesOnBoard} game(s)`;
      console.log(`[cron/publish] week ${w.number}: ${detail}`);
      results.push({ week: w.number, ok: true, detail });
    } else {
      console.error(
        `[cron/publish] week ${w.number} NOT PUBLISHED (${outcome.reason}): ${outcome.message}`,
      );
      results.push({ week: w.number, ok: false, reason: outcome.reason, detail: outcome.message });
    }
  }

  if (due.length === 0) console.log("[cron/publish] no weeks due.");

  const blocked = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: true, due: due.length, published: results.length - blocked, blocked, results });
}
