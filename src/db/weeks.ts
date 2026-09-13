import { and, desc, eq, max } from "drizzle-orm";
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
