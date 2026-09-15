import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Link from "next/link";
import { db } from "@/db";
import { game, pick, seasonEntry, submission, team } from "@/db/schema";
import { getCurrentWeek } from "@/db/weeks";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";
import { matchupLabel, pickLabel } from "@/lib/picks/labels";
import { canSeePick } from "@/lib/picks/reveal";
import { gradePick } from "@/lib/settlement/grade";

export const dynamic = "force-dynamic";

/**
 * League Picks — spec section 4, feature 5.
 *
 * Reveal is enforced here, on the server, by building the view model out
 * of only the picks this viewer is allowed to see. A masked pick
 * contributes a placeholder cell carrying no pick data at all, so
 * nothing hidden is ever serialised into the response. Do not "fix" this
 * by sending everything and hiding in CSS.
 */
type Cell = { visible: true; label: string; result: "WIN" | "LOSS" | "PUSH" | null } | { visible: false };

export default async function LeaguePicksPage() {
  const current = await getCurrentPlayer();
  if (!current) {
    return (
      <Shell>
        <p>We couldn&apos;t find a player record for your account.</p>
      </Shell>
    );
  }
  if (!current.seasonEntry) {
    return (
      <Shell>
        <p>You&apos;re not entered in the active season.</p>
      </Shell>
    );
  }
  const viewerEntry = current.seasonEntry;

  const currentWeek = await getCurrentWeek(viewerEntry.seasonId);
  if (!currentWeek) {
    return (
      <Shell>
        <p>No current week for this season yet.</p>
      </Shell>
    );
  }

  const entries = await db
    .select()
    .from(seasonEntry)
    .where(eq(seasonEntry.seasonId, viewerEntry.seasonId))
    .orderBy(asc(seasonEntry.displayName));

  const submissions = await db
    .select()
    .from(submission)
    .where(eq(submission.weekId, currentWeek.id));
  const submissionByEntry = new Map(submissions.map((s) => [s.seasonEntryId, s]));

  // allSubmitted(week) = every active season_entry has a submission row.
  const notSubmitted = entries.filter((e) => !submissionByEntry.has(e.id));
  const allSubmitted = notSubmitted.length === 0;

  const homeTeam = alias(team, "home_team");
  const awayTeam = alias(team, "away_team");

  const rows = await db
    .select({
      seasonEntryId: pick.seasonEntryId,
      selection: pick.selection,
      gameId: game.id,
      market: game.market,
      spread: game.spread,
      totalPoints: game.totalPoints,
      kickoffAt: game.kickoffAt,
      status: game.status,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      favoriteTeamId: game.favoriteTeamId,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      homeName: homeTeam.canonicalName,
      awayName: awayTeam.canonicalName,
    })
    .from(pick)
    .innerJoin(game, eq(pick.gameId, game.id))
    .innerJoin(homeTeam, eq(game.homeTeamId, homeTeam.id))
    .innerJoin(awayTeam, eq(game.awayTeamId, awayTeam.id))
    .where(
      and(
        eq(pick.weekId, currentWeek.id),
        inArray(
          pick.seasonEntryId,
          entries.map((e) => e.id),
        ),
      ),
    )
    .orderBy(asc(game.kickoffAt));

  const now = new Date();
  const viewer = { seasonEntryId: viewerEntry.id, role: viewerEntry.role };

  const picksByEntry = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = picksByEntry.get(row.seasonEntryId) ?? [];
    list.push(row);
    picksByEntry.set(row.seasonEntryId, list);
  }

  let maskedCount = 0;

  const grid = entries.map((entry) => {
    const sub = submissionByEntry.get(entry.id);
    const entryPicks = picksByEntry.get(entry.id) ?? [];

    const cells: Cell[] = entryPicks.map((row) => {
      const allowed = canSeePick({
        viewer,
        pick: { seasonEntryId: row.seasonEntryId, kickoffAt: row.kickoffAt },
        allSubmitted,
        now,
      });

      if (!allowed) {
        maskedCount++;
        // Nothing about the pick crosses this boundary.
        return { visible: false };
      }

      const isFinal = row.status === "final" && row.homeScore !== null && row.awayScore !== null;
      return {
        visible: true,
        label: `${pickLabel({
          market: row.market,
          selection: row.selection,
          spread: row.spread,
          totalPoints: row.totalPoints,
          homeName: row.homeName,
          awayName: row.awayName,
          favoriteIsHome: row.favoriteTeamId === row.homeTeamId,
        })}  ·  ${matchupLabel(row.homeName, row.awayName)}`,
        result: isFinal
          ? gradePick({ gameId: row.gameId, selection: row.selection }, { ...row, id: row.gameId })
          : null,
      };
    });

    return {
      entryId: entry.id,
      displayName: entry.displayName,
      isSelf: entry.id === viewerEntry.id,
      submittedAt: sub?.submittedAt ?? null,
      pickCount: sub?.pickCount ?? 0,
      cells,
    };
  });

  return (
    <Shell>
      <h1>
        League Picks — Week {currentWeek.number}{" "}
        <span style={{ fontWeight: "normal", fontSize: "0.6em", color: "#888" }}>
          ({currentWeek.status})
        </span>
      </h1>

      <p
        style={{
          padding: "0.6rem 0.8rem",
          background: allSubmitted ? "#e6f4ea" : "#fff3cd",
          border: "1px solid rgba(0,0,0,0.1)",
        }}
      >
        {allSubmitted
          ? `All ${entries.length} players have submitted — every pick is visible.`
          : `${notSubmitted.length} of ${entries.length} players have yet to submit: ${notSubmitted
              .map((e) => e.displayName)
              .join(", ")}. Their opponents' picks stay hidden until kickoff.`}
      </p>

      {maskedCount > 0 && (
        <p style={{ fontSize: "0.85em", color: "#666" }}>
          {maskedCount} pick{maskedCount === 1 ? "" : "s"} hidden from you. Hidden picks are filtered
          out on the server — they are not in this page&apos;s payload.
        </p>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9em" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
            <th style={{ padding: "0.4rem" }}>Player</th>
            <th style={{ padding: "0.4rem" }}>Submitted</th>
            <th style={{ padding: "0.4rem" }}>Picks</th>
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr
              key={row.entryId}
              style={{
                borderBottom: "1px solid #eee",
                background: row.isSelf ? "rgba(37,99,235,0.08)" : undefined,
              }}
            >
              <td style={{ padding: "0.4rem", whiteSpace: "nowrap", fontWeight: row.isSelf ? "bold" : "normal" }}>
                {row.displayName}
                {row.isSelf ? " (you)" : ""}
              </td>
              <td style={{ padding: "0.4rem", whiteSpace: "nowrap", color: row.submittedAt ? undefined : "#b00020" }}>
                {row.submittedAt ? `${row.pickCount} picks` : "not yet"}
              </td>
              <td style={{ padding: "0.4rem" }}>
                {row.cells.length === 0 ? (
                  <span style={{ color: "#999" }}>—</span>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                    {row.cells.map((cell, i) =>
                      cell.visible ? (
                        <span
                          key={i}
                          style={{
                            padding: "0.15rem 0.4rem",
                            border: "1px solid #ddd",
                            borderLeft: `3px solid ${
                              cell.result === "WIN"
                                ? "#1a7f37"
                                : cell.result === "LOSS"
                                  ? "#b00020"
                                  : cell.result === "PUSH"
                                    ? "#b8860b"
                                    : "#ccc"
                            }`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cell.label}
                        </span>
                      ) : (
                        <span
                          key={i}
                          title="Hidden until this game kicks off or everyone has submitted"
                          style={{
                            padding: "0.15rem 0.4rem",
                            border: "1px dashed #bbb",
                            color: "#999",
                            background: "repeating-linear-gradient(45deg,#f6f6f6,#f6f6f6 4px,#efefef 4px,#efefef 8px)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          🔒 hidden
                        </span>
                      ),
                    )}
                  </div>
                )}
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
        <Link href="/weekly-results">Weekly Results</Link>
        <Link href="/standings">Standings</Link>
        <Link href="/my-picks">My Picks</Link>
      </nav>
      {children}
    </main>
  );
}
