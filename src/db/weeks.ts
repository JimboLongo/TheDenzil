import { and, desc, eq, max } from "drizzle-orm";
import { TOTAL_WEEKS } from "@/lib/board/grid";
import { addCalendarDays, dayOfWeekOf, etWallTimeToUtc, type CalendarDate } from "@/lib/dates";
import { db } from "./index";
import { game, week } from "./schema";

type WeekRow = typeof week.$inferSelect;

/**
 * Self-healing: an 'open' week whose on-board games have all kicked off
 * moves to 'settling' the next time anything asks for it, rather than
 * needing a cron job. Only touches the row when it's actually due —
 * cheap to call on every getCurrentWeek().
 */
async function maybeAdvanceToSettling(weekRow: WeekRow): Promise<WeekRow> {
  if (weekRow.status !== "open") return weekRow;

  const [{ maxKickoff }] = await db
    .select({ maxKickoff: max(game.kickoffAt) })
    .from(game)
    .where(and(eq(game.weekId, weekRow.id), eq(game.isOnBoard, true)));

  if (!maxKickoff || new Date() <= maxKickoff) return weekRow;

  const [updated] = await db
    .update(week)
    .set({ status: "settling" })
    .where(eq(week.id, weekRow.id))
    .returning();

  return updated;
}

/**
 * The current week for a season: the 'open' week if one exists (after
 * checking whether it just aged into 'settling'), else the most recent
 * 'settling' week, else the most recent 'final' week. Never a
 * timestamp heuristic — status is the single source of truth, because
 * picks, results, and standings all have to agree on what "current"
 * means.
 */
export async function getCurrentWeek(seasonId: number): Promise<WeekRow | null> {
  const [openWeek] = await db
    .select()
    .from(week)
    .where(and(eq(week.seasonId, seasonId), eq(week.status, "open")))
    .limit(1);

  if (openWeek) {
    const resolved = await maybeAdvanceToSettling(openWeek);
    if (resolved.status === "open") return resolved;
    // Just aged into 'settling' — fall through so the query below
    // picks it up (or a more recent settling week, if one somehow
    // exists).
  }

  const [settlingWeek] = await db
    .select()
    .from(week)
    .where(and(eq(week.seasonId, seasonId), eq(week.status, "settling")))
    .orderBy(desc(week.number))
    .limit(1);
  if (settlingWeek) return settlingWeek;

  const [finalWeek] = await db
    .select()
    .from(week)
    .where(and(eq(week.seasonId, seasonId), eq(week.status, "final")))
    .orderBy(desc(week.number))
    .limit(1);

  return finalWeek ?? null;
}

export type GenerateWeeksResult = {
  ok: boolean;
  message: string;
  created: number[];
  skipped: number[];
};

/**
 * Creates weeks 1-18 for a season: startsAt Saturday 00:00 ET, endsAt
 * Monday 23:59 ET, type 'regular', status 'upcoming'. Never overwrites
 * — a week number that already exists is skipped outright, same
 * protection as the grid save has for published weeks.
 */
export async function generateSeasonWeeks(
  seasonId: number,
  firstSaturday: CalendarDate,
): Promise<GenerateWeeksResult> {
  if (dayOfWeekOf(firstSaturday) !== 6) {
    return {
      ok: false,
      message: `${firstSaturday.year}-${String(firstSaturday.month).padStart(2, "0")}-${String(firstSaturday.day).padStart(2, "0")} is not a Saturday.`,
      created: [],
      skipped: [],
    };
  }

  const existing = await db
    .select({ number: week.number })
    .from(week)
    .where(eq(week.seasonId, seasonId));
  const existingNumbers = new Set(existing.map((w) => w.number));

  const created: number[] = [];
  const skipped: number[] = [];

  for (let n = 1; n <= TOTAL_WEEKS; n++) {
    if (existingNumbers.has(n)) {
      skipped.push(n);
      continue;
    }

    const saturday = addCalendarDays(firstSaturday, (n - 1) * 7);
    const monday = addCalendarDays(saturday, 2);

    await db.insert(week).values({
      seasonId,
      number: n,
      type: "regular",
      status: "upcoming",
      startsAt: etWallTimeToUtc(saturday.year, saturday.month, saturday.day, 0, 0, 0),
      endsAt: etWallTimeToUtc(monday.year, monday.month, monday.day, 23, 59, 59),
    });

    created.push(n);
  }

  return {
    ok: true,
    message:
      skipped.length > 0
        ? `Created ${created.length} week(s), skipped ${skipped.length} (already exist).`
        : `Created ${created.length} week(s).`,
    created,
    skipped,
  };
}
