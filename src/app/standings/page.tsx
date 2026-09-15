import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import React from "react";
import { db } from "@/db";
import { season, seasonEntry, week, weekResult } from "@/db/schema";
import { getCurrentWeek } from "@/db/weeks";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";
import { formatCents } from "@/lib/picks/labels";
import { parseSettlementConfig } from "@/lib/settlement/config";
import { leadingGroup } from "@/lib/settlement/rates";

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
  const config = parseSettlementConfig(seasonRow.config);

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
      <h1>Standings</h1>
      <p style={{ color: "#666", fontSize: "0.9em" }}>
        {settledWeekIds.size} of {weeks.length} weeks settled
        {currentWeek ? ` · current week ${currentWeek.number} (${currentWeek.status})` : ""}
      </p>

      {settledWeekIds.size === 0 && (
        <p style={{ padding: "0.6rem 0.8rem", background: "#fff3cd" }}>
          No weeks have been settled yet, so every figure below is zero.
        </p>
      )}

      <p style={{ fontSize: "0.85em", color: "#666" }}>
        Rank is by <strong>cumulative dollars lost only</strong>. Weekly winnings and awards are shown
        separately and do not affect rank.
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9em" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
            <th style={{ padding: "0.4rem" }}>Rank</th>
            <th style={{ padding: "0.4rem" }}>Player</th>
            <th style={{ padding: "0.4rem", textAlign: "right" }}>Lost (ranks on this)</th>
            <th style={{ padding: "0.4rem", textAlign: "right", color: "#666" }}>Weekly wins</th>
            <th style={{ padding: "0.4rem", textAlign: "right", color: "#666" }}>Weekly winnings</th>
            <th style={{ padding: "0.4rem", textAlign: "right", color: "#666" }}>Denzils</th>
            <th style={{ padding: "0.4rem", textAlign: "right", color: "#666" }}>Award $</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <React.Fragment key={r.entryId}>
              <tr
                style={{
                  borderBottom: "1px solid #eee",
                  background: r.isSelf ? "rgba(37,99,235,0.08)" : undefined,
                }}
              >
                <td style={{ padding: "0.4rem" }}>{r.rank}</td>
                <td style={{ padding: "0.4rem", fontWeight: r.isSelf ? "bold" : "normal" }}>
                  {r.displayName}
                  {r.isSelf ? " (you)" : ""}
                </td>
                <td style={{ padding: "0.4rem", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: "bold" }}>
                  {formatCents(r.cumulativeGrossLossCents)}
                </td>
                <td style={{ padding: "0.4rem", textAlign: "right", color: "#666" }}>{r.weeklyWins || "—"}</td>
                <td style={{ padding: "0.4rem", textAlign: "right", color: "#666", fontVariantNumeric: "tabular-nums" }}>
                  {r.weeklyWinningsCents ? formatCents(r.weeklyWinningsCents) : "—"}
                </td>
                <td style={{ padding: "0.4rem", textAlign: "right", color: "#666" }}>{r.denzilCount || "—"}</td>
                <td style={{ padding: "0.4rem", textAlign: "right", color: "#666", fontVariantNumeric: "tabular-nums" }}>
                  {r.denzilCents ? formatCents(r.denzilCents) : "—"}
                </td>
              </tr>
              {showCutoff && i + 1 === cutoffAfterIndex && (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    <div
                      style={{
                        borderTop: "3px double #b00020",
                        color: "#b00020",
                        fontSize: "0.8em",
                        padding: "0.25rem 0.4rem",
                        background: "rgba(176,0,32,0.05)",
                      }}
                    >
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
            <tr key={r.entryId} style={{ borderBottom: "1px solid #eee", color: "#999" }}>
              <td style={{ padding: "0.4rem" }}>—</td>
              <td style={{ padding: "0.4rem" }}>
                {r.displayName}
                {r.isSelf ? " (you)" : ""}{" "}
                <span style={{ fontSize: "0.8em" }}>(not Season Pool eligible)</span>
              </td>
              <td style={{ padding: "0.4rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {formatCents(r.cumulativeGrossLossCents)}
              </td>
              <td style={{ padding: "0.4rem", textAlign: "right" }}>{r.weeklyWins || "—"}</td>
              <td style={{ padding: "0.4rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.weeklyWinningsCents ? formatCents(r.weeklyWinningsCents) : "—"}
              </td>
              <td style={{ padding: "0.4rem", textAlign: "right" }}>{r.denzilCount || "—"}</td>
              <td style={{ padding: "0.4rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.denzilCents ? formatCents(r.denzilCents) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
      <nav style={{ marginBottom: "1rem", display: "flex", gap: "1rem", fontSize: "0.9em" }}>
        <Link href="/">Home</Link>
        <Link href="/league-picks">League Picks</Link>
        <Link href="/weekly-results">Weekly Results</Link>
        <Link href="/my-picks">My Picks</Link>
      </nav>
      {children}
    </main>
  );
}
