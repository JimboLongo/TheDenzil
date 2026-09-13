import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { player, season, seasonEntry } from "@/db/schema";

export type CurrentPlayer = {
  player: typeof player.$inferSelect;
  seasonEntry: typeof seasonEntry.$inferSelect | null;
};

/**
 * Resolves the signed-in session to a player row by email, plus that
 * player's season_entry for the active season (status = 'active'), if
 * any. Returns null when there's no session, the email isn't a member
 * of the league, or there's no active season row at all.
 */
export async function getCurrentPlayer(): Promise<CurrentPlayer | null> {
  const authSession = await auth();
  const email = authSession?.user?.email;
  if (!email) return null;

  const [playerRow] = await db
    .select()
    .from(player)
    .where(eq(player.email, email))
    .limit(1);
  if (!playerRow) return null;

  const [activeSeason] = await db
    .select()
    .from(season)
    .where(eq(season.status, "active"))
    .limit(1);
  if (!activeSeason) return { player: playerRow, seasonEntry: null };

  const [entryRow] = await db
    .select()
    .from(seasonEntry)
    .where(
      and(
        eq(seasonEntry.playerId, playerRow.id),
        eq(seasonEntry.seasonId, activeSeason.id),
      ),
    )
    .limit(1);

  return { player: playerRow, seasonEntry: entryRow ?? null };
}

/**
 * Defense in depth for commish-only Server Actions: Proxy already
 * blocks /commish/* for non-commish sessions, but Proxy coverage can
 * silently disappear from a route (matcher edit, a Server Function
 * moved elsewhere), so every mutating action re-checks here too.
 */
export async function requireCommish(): Promise<CurrentPlayer> {
  const current = await getCurrentPlayer();
  if (!current || current.seasonEntry?.role !== "commish") {
    throw new Error(
      "Not authorized: commissioner role required for the active season.",
    );
  }
  return current;
}
