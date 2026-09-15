import { eq, inArray } from "drizzle-orm";
import React from "react";
import { db } from "@/db";
import { season, seasonEntry, week, weekResult } from "@/db/schema";
import { getCurrentWeek } from "@/db/weeks";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";
import { formatCents } from "@/lib/picks/labels";
import { parseSettlementConfig } from "@/lib/settlement/config";
import { leadingGroup } from "@/lib/settlement/rates";
import { PageShell as Shell } from "../_components/PageShell";

export const dynamic = "force-dynamic";

/**
 * Standings — spec section 4, feature 9.
 *
 * Rank is by cumulative gross loss alone. Weekly winnings and awards sit
 * in their own columns and are never folded into the ranking figure,
 * because the spec is blunt about it: "Keep weekly winnings and awards
 * visibly separate from standings on every screen, or people will
 * argue."
 *
 * The weeks 12-17 handicap cutoff is drawn with the same leadingGroup()
 * the engine uses to assign the rate, so the line can't disagree with
 * who actually gets charged $2.25.
 */
export default async function StandingsPage() {
  const current = await getCurrentPlayer();
  if (!current?.seasonEntry) {
    return (
      <Shell>
        <p>You&apos;re not entered in the active season.</p>
      </Shell>
    );
  }
  const viewerEntry = current.seasonEntry;

  const [seasonRow] = await db.select().from(season).where(eq(season.id, viewerEntry.seasonId)).limit(1);
  // A season with no settlement config can't be scored. That's worth
  // saying plainly rather than 500-ing at a player who just wants to see
  // where they stand.
  let config;
  try {
    config = parseSettlementConfig(seasonRow.config);
  } catch (err) {
    return (
      <Shell>
        <h1>Standings</h1>
        <p>This season has no settlement configuration yet, so there&apos;s nothing to rank.</p>
        <p className="text-sm text-text-muted">{(err as Error).message}</p>
      </Shell>
    );
  }

  const entries = await db.select().from(seasonEntry).where(eq(seasonEntry.seasonId, viewerEntry.seasonId));
  const weeks = await db.select().from(week).where(eq(week.seasonId, viewerEntry.seasonId));
  const results = weeks.length
    ? await db
        .select()
        .from(weekResult)
        .where(inArray(weekResult.weekId, weeks.map((w) => w.id)))
    : [];

  const currentWeek = await getCurrentWeek(viewerEntry.seasonId);
  const settledWeekIds = new Set(results.map((r) => r.weekId));

  type Row = {
    entryId: number;
    displayName: string;
    isSelf: boolean;
    eligible: boolean;
    cumulativeGrossLossCents: number;
    weeklyWins: number;
    weeklyWinningsCents: number;
    denzilCount: number;
    denzilCents: number;
    rank: number | null;
  };

  const byEntry = new Map<number, Row>(
    entries.map((e) => [
      e.id,
      {
        entryId: e.id,
        displayName: e.displayName,
        isSelf: e.id === viewerEntry.id,
        eligible: e.seasonPoolEligible,
        cumulativeGrossLossCents: 0,
        weeklyWins: 0,
        weeklyWinningsCents: 0,
        denzilCount: 0,
        denzilCents: 0,
        rank: null,
      },
    ]),
  );

  for (const r of results) {
    const row = byEntry.get(r.seasonEntryId);
    if (!row) continue;
    row.cumulativeGrossLossCents += r.grossLossCents;
    row.weeklyWinningsCents += r.weeklyWinShareCents;
    if (r.weeklyWinShareCents > 0) row.weeklyWins++;
    row.denzilCents += r.denzilAwardCents;
    if (r.denzilAwardCents > 0) row.denzilCount++;
  }

  const all = [...byEntry.values()];
  // Season Pool eligibility gates the standings (league rule 1); the
  // ineligible still played, so they're listed, just unranked.
  const ranked = all
    .filter((r) => r.eligible)
    .sort((a, b) => a.cumulativeGrossLossCents - b.cumulativeGrossLossCents);
  const unranked = all.filter((r) => !r.eligible);

  let cursor = 0;
  while (cursor < ranked.length) {
    const value = ranked[cursor].cumulativeGrossLossCents;
    let end = cursor;
    while (end < ranked.length && ranked[end].cumulativeGrossLossCents === value) end++;
    for (let i = cursor; i < end; i++) ranked[i].rank = cursor + 1;
    cursor = end;
  }

  const [firstLeaderWeek, lastLeaderWeek] = config.leaderWeekRange;
  const showCutoff =
    currentWeek !== null &&
    currentWeek.number >= firstLeaderWeek &&
    currentWeek.number <= lastLeaderWeek &&
    ranked.length > 0;

  // Same call the engine makes — ties at the cutoff are all included, so
  // this group can be larger than leaderCount.
  const leaders = showCutoff
    ? leadingGroup(
        new Map(ranked.map((r) => [r.entryId, r.cumulativeGrossLossCents])),
        config.leaderCount,
      )
    : null;
  const cutoffAfterIndex = leaders ? ranked.filter((r) => leaders.has(r.entryId)).length : -1;

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Standings</h1>
      <p className="text-sm text-text-muted">
        {settledWeekIds.size} of {weeks.length} weeks settled
        {currentWeek ? ` · current week ${currentWeek.number} (${currentWeek.status})` : ""}
      </p>

      {settledWeekIds.size === 0 && (
        <p className="rounded border border-warning-border bg-warning px-3 py-2 text-warning-fg">
          No weeks have been settled yet, so every figure below is zero.
        </p>
      )}

      <p className="text-sm text-text-muted">
        Rank is by <strong className="text-text">cumulative dollars lost only</strong>. Weekly winnings
        and awards are shown separately and do not affect rank.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border-strong text-left">
              <th className="p-1.5">Rank</th>
              <th className="p-1.5">Player</th>
              <th className="p-1.5 text-right">Lost (ranks on this)</th>
              <th className="p-1.5 text-right text-text-muted">Weekly wins</th>
              <th className="p-1.5 text-right text-text-muted">Weekly winnings</th>
              <th className="p-1.5 text-right text-text-muted">Denzils</th>
              <th className="p-1.5 text-right text-text-muted">Award $</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <React.Fragment key={r.entryId}>
                <tr className={`border-b border-border ${r.isSelf ? "bg-row-self" : ""}`}>
                  <td className="p-1.5">{r.rank}</td>
                  <td className={`p-1.5 ${r.isSelf ? "font-bold" : ""}`}>
                    {r.displayName}
                    {r.isSelf ? " (you)" : ""}
                  </td>
                  <td className="p-1.5 text-right font-bold tabular-nums">
                    {formatCents(r.cumulativeGrossLossCents)}
                  </td>
                  <td className="p-1.5 text-right text-text-muted">{r.weeklyWins || "—"}</td>
                  <td className="p-1.5 text-right text-text-muted tabular-nums">
                    {r.weeklyWinningsCents ? formatCents(r.weeklyWinningsCents) : "—"}
                  </td>
                  <td className="p-1.5 text-right text-text-muted">{r.denzilCount || "—"}</td>
                  <td className="p-1.5 text-right text-text-muted tabular-nums">
                    {r.denzilCents ? formatCents(r.denzilCents) : "—"}
                  </td>
                </tr>
                {showCutoff && i + 1 === cutoffAfterIndex && (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <div className="border-t-[3px] border-double border-danger-border bg-danger px-2 py-1 text-xs text-danger-fg">
                        {`── handicap cutoff ── the ${cutoffAfterIndex} player${cutoffAfterIndex === 1 ? "" : "s"} above pay `}
                        {formatCents(config.leaderLossCents)}/loss in week {currentWeek!.number}
                        {cutoffAfterIndex > config.leaderCount &&
                          ` (${cutoffAfterIndex}, not ${config.leaderCount} — everyone tied at ${config.leaderCount}th is included)`}
                        ; everyone below pays {formatCents(config.baseLossCents)}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}

            {unranked.map((r) => (
              <tr key={r.entryId} className="border-b border-border text-text-muted">
                <td className="p-1.5">—</td>
                <td className="p-1.5">
                  {r.displayName}
                  {r.isSelf ? " (you)" : ""} <span className="text-xs">(not Season Pool eligible)</span>
                </td>
                <td className="p-1.5 text-right tabular-nums">
                  {formatCents(r.cumulativeGrossLossCents)}
                </td>
                <td className="p-1.5 text-right">{r.weeklyWins || "—"}</td>
                <td className="p-1.5 text-right tabular-nums">
                  {r.weeklyWinningsCents ? formatCents(r.weeklyWinningsCents) : "—"}
                </td>
                <td className="p-1.5 text-right">{r.denzilCount || "—"}</td>
                <td className="p-1.5 text-right tabular-nums">
                  {r.denzilCents ? formatCents(r.denzilCents) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

