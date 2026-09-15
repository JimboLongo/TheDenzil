import { and, eq, inArray, lt } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { game, pick, season, seasonEntry, submission, week, weekResult } from "@/db/schema";
import { getCurrentWeek } from "@/db/weeks";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";
import { isOnDenzilWatch } from "@/lib/picks/denzilWatch";
import { formatCents } from "@/lib/picks/labels";
import { parseSettlementConfig } from "@/lib/settlement/config";
import { gradePick } from "@/lib/settlement/grade";
import { assignRate, leadingGroup } from "@/lib/settlement/rates";

export const dynamic = "force-dynamic";

/**
 * Weekly Results — spec section 4, feature 8. Records and dollars as
 * games settle, so this grades live rather than reading week_result:
 * a week in progress has no settled row yet, and the Denzil watch only
 * means anything before the last game is final.
 *
 * Rates come from the same assignRate() the settlement engine uses, so
 * what's shown here can't drift from what gets banked.
 */
export default async function WeeklyResultsPage() {
  const current = await getCurrentPlayer();
  if (!current?.seasonEntry) {
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

  const [seasonRow] = await db.select().from(season).where(eq(season.id, viewerEntry.seasonId)).limit(1);
  const config = parseSettlementConfig(seasonRow.config);

  const entries = await db
    .select()
    .from(seasonEntry)
    .where(eq(seasonEntry.seasonId, viewerEntry.seasonId));

  // Standings entering this week, for the weeks 12-17 handicap. Reading
  // the week_result cache is fine for display; settlement itself always
  // rebuilds from picks.
  const priorWeeks = await db
    .select({ id: week.id })
    .from(week)
    .where(and(eq(week.seasonId, viewerEntry.seasonId), lt(week.number, currentWeek.number)));
  const priorResults = priorWeeks.length
    ? await db
        .select()
        .from(weekResult)
        .where(inArray(weekResult.weekId, priorWeeks.map((w) => w.id)))
    : [];

  const cumulativeEntering = new Map<number, number>(entries.map((e) => [e.id, 0]));
  for (const r of priorResults) {
    cumulativeEntering.set(r.seasonEntryId, (cumulativeEntering.get(r.seasonEntryId) ?? 0) + r.grossLossCents);
  }

  const [firstLeaderWeek, lastLeaderWeek] = config.leaderWeekRange;
  const inLeaderWindow = currentWeek.number >= firstLeaderWeek && currentWeek.number <= lastLeaderWeek;
  const leaders = inLeaderWindow ? leadingGroup(cumulativeEntering, config.leaderCount) : null;

  const submissions = await db.select().from(submission).where(eq(submission.weekId, currentWeek.id));
  const submissionByEntry = new Map(submissions.map((s) => [s.seasonEntryId, s]));

  const picks = await db
    .select({
      seasonEntryId: pick.seasonEntryId,
      selection: pick.selection,
      gameId: game.id,
      market: game.market,
      spread: game.spread,
      totalPoints: game.totalPoints,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      favoriteTeamId: game.favoriteTeamId,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      status: game.status,
    })
    .from(pick)
    .innerJoin(game, eq(pick.gameId, game.id))
    .where(eq(pick.weekId, currentWeek.id));

  const picksByEntry = new Map<number, typeof picks>();
  for (const p of picks) {
    const list = picksByEntry.get(p.seasonEntryId) ?? [];
    list.push(p);
    picksByEntry.set(p.seasonEntryId, list);
  }

  const weekIsLive = currentWeek.status === "open";

  const results = entries.map((entry) => {
    const sub = submissionByEntry.get(entry.id);
    const rate = assignRate({
      weekNumber: currentWeek.number,
      isSpeedWeekForAll: currentWeek.isSpeedWeekForAll,
      isSpeedDeclared: sub?.isSpeedDeclared ?? false,
      inLeadingGroup: leaders?.has(entry.id) ?? false,
      config,
    });

    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let pending = 0;

    // Still open means they can still submit — that's the rolling lock,
    // not a rule 12 auto-loss. Only once the week stops accepting picks
    // does a missing slip become nine losses.
    const awaitingSubmission = !sub && weekIsLive;
    const isAutoLoss = !sub && !weekIsLive;

    if (isAutoLoss) {
      losses = config.picksPerWeek;
    } else if (sub) {
      for (const p of picksByEntry.get(entry.id) ?? []) {
        if (p.status !== "final" || p.homeScore === null || p.awayScore === null) {
          pending++;
          continue;
        }
        const grade = gradePick({ gameId: p.gameId, selection: p.selection }, { ...p, id: p.gameId });
        if (grade === "WIN") wins++;
        else if (grade === "LOSS") losses++;
        else pushes++;
      }
    }

    const grossLossCents = losses * rate.cents;

    return {
      entryId: entry.id,
      displayName: entry.displayName,
      isSelf: entry.id === viewerEntry.id,
      awaitingSubmission,
      isAutoLoss,
      wins,
      losses,
      pushes,
      pending,
      rate,
      grossLossCents,
      isMaryRose: wins === config.picksPerWeek && losses === 0 && pushes === 0,
      // A Denzil needs a submission (league rule 7) and a clean 0-9.
      isDenzil: Boolean(sub) && wins === 0 && losses === config.picksPerWeek && pushes === 0,
      onDenzilWatch: isOnDenzilWatch({ hasSubmitted: Boolean(sub), wins, losses, pushes, pending }),
    };
  });

  results.sort((a, b) => {
    if (a.awaitingSubmission !== b.awaitingSubmission) return a.awaitingSubmission ? 1 : -1;
    return a.grossLossCents - b.grossLossCents;
  });

  const scored = results.filter((r) => !r.awaitingSubmission);
  const minLoss = scored.length ? Math.min(...scored.map((r) => r.grossLossCents)) : 0;
  const winners = scored.filter((r) => r.grossLossCents === minLoss);
  const anyPending = results.some((r) => r.pending > 0) || results.some((r) => r.awaitingSubmission);
  const watchers = results.filter((r) => r.onDenzilWatch);

  return (
    <Shell>
      <h1>
        Weekly Results — Week {currentWeek.number}{" "}
        <span style={{ fontWeight: "normal", fontSize: "0.6em", color: "#888" }}>({currentWeek.status})</span>
      </h1>

      <p style={{ padding: "0.6rem 0.8rem", background: "#eef2ff", border: "1px solid rgba(0,0,0,0.1)" }}>
        <strong>{anyPending ? "Projected winner" : "Weekly winner"}:</strong>{" "}
        {winners.length === 0
          ? "—"
          : `${winners.map((w) => w.displayName).join(", ")} at ${formatCents(minLoss)} lost`}
        {winners.length > 1 && ` — ${winners.length}-way tie, pool splits evenly`}
        {anyPending && " (games still to finish)"}
      </p>

      {watchers.length > 0 && (
        <p style={{ padding: "0.6rem 0.8rem", background: "#fdecea", border: "1px solid #f5c2c0" }}>
          <strong>Denzil watch:</strong>{" "}
          {watchers
            .map((w) => `${w.displayName} (${w.wins}-${w.losses}, ${w.pending} left)`)
            .join(" · ")}
        </p>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9em" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
            <th style={{ padding: "0.4rem" }}>#</th>
            <th style={{ padding: "0.4rem" }}>Player</th>
            <th style={{ padding: "0.4rem" }}>Record</th>
            <th style={{ padding: "0.4rem" }}>Pending</th>
            <th style={{ padding: "0.4rem" }}>Rate</th>
            <th style={{ padding: "0.4rem", textAlign: "right" }}>Lost</th>
            <th style={{ padding: "0.4rem" }}>Badges</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const isWinner = winners.some((w) => w.entryId === r.entryId);
            return (
              <tr
                key={r.entryId}
                style={{
                  borderBottom: "1px solid #eee",
                  background: isWinner
                    ? "rgba(26,127,55,0.10)"
                    : r.isSelf
                      ? "rgba(37,99,235,0.08)"
                      : undefined,
                }}
              >
                <td style={{ padding: "0.4rem", color: "#888" }}>{r.awaitingSubmission ? "—" : i + 1}</td>
                <td style={{ padding: "0.4rem", fontWeight: r.isSelf || isWinner ? "bold" : "normal" }}>
                  {r.displayName}
                  {r.isSelf ? " (you)" : ""}
                </td>
                <td style={{ padding: "0.4rem" }}>
                  {r.awaitingSubmission ? (
                    <span style={{ color: "#b8860b" }}>not submitted yet</span>
                  ) : r.isAutoLoss ? (
                    <span style={{ color: "#b00020" }}>no show — 0-{r.losses}</span>
                  ) : (
                    `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`
                  )}
                </td>
                <td style={{ padding: "0.4rem", color: r.pending ? "#b8860b" : "#ccc" }}>
                  {r.pending || "—"}
                </td>
                <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                  {r.rate.kind} {formatCents(r.rate.cents)}
                </td>
                <td style={{ padding: "0.4rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {r.awaitingSubmission ? "—" : formatCents(r.grossLossCents)}
                </td>
                <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                  {isWinner && !r.awaitingSubmission && <Badge bg="#1a7f37">weekly winner</Badge>}
                  {r.isMaryRose && <Badge bg="#6b21a8">Mary Rose 9-0</Badge>}
                  {r.isDenzil && <Badge bg="#b00020">Denzil 0-9</Badge>}
                  {r.onDenzilWatch && <Badge bg="#b8860b">Denzil watch</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p style={{ fontSize: "0.8em", color: "#666", marginTop: "1rem" }}>
        Dollars are gross loss only. Weekly pool winnings and awards are tracked separately — see{" "}
        <Link href="/standings">Standings</Link>.
      </p>
    </Shell>
  );
}

function Badge({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        background: bg,
        color: "#fff",
        borderRadius: 3,
        padding: "0.1rem 0.35rem",
        fontSize: "0.75em",
        marginRight: "0.25rem",
      }}
    >
      {children}
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
      <nav style={{ marginBottom: "1rem", display: "flex", gap: "1rem", fontSize: "0.9em" }}>
        <Link href="/">Home</Link>
        <Link href="/league-picks">League Picks</Link>
        <Link href="/standings">Standings</Link>
        <Link href="/my-picks">My Picks</Link>
      </nav>
      {children}
    </main>
  );
}
