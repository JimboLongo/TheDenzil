import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { game, pick, seasonEntry, submission, team } from "@/db/schema";
import { getCurrentWeek } from "@/db/weeks";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";
import { matchupLabel, pickLabel } from "@/lib/picks/labels";
import { canSeePick } from "@/lib/picks/reveal";
import { gradePick } from "@/lib/settlement/grade";
import { PageShell as Shell } from "../_components/PageShell";

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
      <h1 className="text-xl font-semibold">
        League Picks — Week {currentWeek.number}{" "}
        <span className="text-sm font-normal text-text-muted">({currentWeek.status})</span>
      </h1>

      <p
        className={`rounded border px-3 py-2 ${
          allSubmitted
            ? "border-success-border bg-success text-success-fg"
            : "border-warning-border bg-warning text-warning-fg"
        }`}
      >
        {allSubmitted
          ? `All ${entries.length} players have submitted — every pick is visible.`
          : `${notSubmitted.length} of ${entries.length} players have yet to submit: ${notSubmitted
              .map((e) => e.displayName)
              .join(", ")}. Their opponents' picks stay hidden until kickoff.`}
      </p>

      {maskedCount > 0 && (
        <p className="text-sm text-text-muted">
          {maskedCount} pick{maskedCount === 1 ? "" : "s"} hidden from you. Hidden picks are filtered
          out on the server — they are not in this page&apos;s payload.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border-strong text-left">
              <th className="p-1.5">Player</th>
              <th className="p-1.5">Submitted</th>
              <th className="p-1.5">Picks</th>
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr
                key={row.entryId}
                className={`border-b border-border ${row.isSelf ? "bg-row-self" : ""}`}
              >
                <td className={`p-1.5 whitespace-nowrap ${row.isSelf ? "font-bold" : ""}`}>
                  {row.displayName}
                  {row.isSelf ? " (you)" : ""}
                </td>
                <td
                  className={`p-1.5 whitespace-nowrap ${row.submittedAt ? "" : "text-danger-fg"}`}
                >
                  {row.submittedAt ? `${row.pickCount} picks` : "not yet"}
                </td>
                <td className="p-1.5">
                  {row.cells.length === 0 ? (
                    <span className="text-text-muted">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.cells.map((cell, i) =>
                        cell.visible ? (
                          <span
                            key={i}
                            className={`whitespace-nowrap rounded-sm border border-border border-l-[3px] px-1.5 py-0.5 ${
                              cell.result === "WIN"
                                ? "border-l-success-border"
                                : cell.result === "LOSS"
                                  ? "border-l-danger-border"
                                  : cell.result === "PUSH"
                                    ? "border-l-warning-border"
                                    : "border-l-border-strong"
                            }`}
                          >
                            {cell.label}
                          </span>
                        ) : (
                          <span
                            key={i}
                            title="Hidden until this game kicks off or everyone has submitted"
                            className="whitespace-nowrap rounded-sm border border-dashed border-border-strong bg-surface-raised px-1.5 py-0.5 text-text-muted"
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
      </div>
    </Shell>
  );
}

