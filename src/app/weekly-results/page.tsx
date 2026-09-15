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
import { PageShell as Shell } from "../_components/PageShell";

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
  // Same reasoning as Standings: no config means no rates, and a clear
  // sentence beats a white error screen.
  let config;
  try {
    config = parseSettlementConfig(seasonRow.config);
  } catch (err) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Weekly Results</h1>
        <p>This season has no settlement configuration yet, so records can&apos;t be priced.</p>
        <p className="text-sm text-text-muted">{(err as Error).message}</p>
      </Shell>
    );
  }

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
      <h1 className="text-xl font-semibold">
        Weekly Results — Week {currentWeek.number}{" "}
        <span className="text-sm font-normal text-text-muted">({currentWeek.status})</span>
      </h1>

      <p className="rounded border border-info-border bg-info px-3 py-2 text-info-fg">
        <strong>{anyPending ? "Projected winner" : "Weekly winner"}:</strong>{" "}
        {winners.length === 0
          ? "—"
          : `${winners.map((w) => w.displayName).join(", ")} at ${formatCents(minLoss)} lost`}
        {winners.length > 1 && ` — ${winners.length}-way tie, pool splits evenly`}
        {anyPending && " (games still to finish)"}
      </p>

      {watchers.length > 0 && (
        <p className="rounded border border-danger-border bg-danger px-3 py-2 text-danger-fg">
          <strong>Denzil watch:</strong>{" "}
          {watchers
            .map((w) => `${w.displayName} (${w.wins}-${w.losses}, ${w.pending} left)`)
            .join(" · ")}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border-strong text-left">
              <th className="p-1.5">#</th>
              <th className="p-1.5">Player</th>
              <th className="p-1.5">Record</th>
              <th className="p-1.5">Pending</th>
              <th className="p-1.5">Rate</th>
              <th className="p-1.5 text-right">Lost</th>
              <th className="p-1.5">Badges</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              const isWinner = winners.some((w) => w.entryId === r.entryId);
              return (
                <tr
                  key={r.entryId}
                  className={`border-b border-border ${
                    isWinner ? "bg-row-winner" : r.isSelf ? "bg-row-self" : ""
                  }`}
                >
                  <td className="p-1.5 text-text-muted">{r.awaitingSubmission ? "—" : i + 1}</td>
                  <td className={`p-1.5 ${r.isSelf || isWinner ? "font-bold" : ""}`}>
                    {r.displayName}
                    {r.isSelf ? " (you)" : ""}
                  </td>
                  <td className="p-1.5">
                    {r.awaitingSubmission ? (
                      <span className="text-warning-fg">not submitted yet</span>
                    ) : r.isAutoLoss ? (
                      <span className="text-danger-fg">no show — 0-{r.losses}</span>
                    ) : (
                      `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`
                    )}
                  </td>
                  <td className={`p-1.5 ${r.pending ? "text-warning-fg" : "text-text-muted"}`}>
                    {r.pending || "—"}
                  </td>
                  <td className="p-1.5 whitespace-nowrap">
                    {r.rate.kind} {formatCents(r.rate.cents)}
                  </td>
                  <td className="p-1.5 text-right tabular-nums">
                    {r.awaitingSubmission ? "—" : formatCents(r.grossLossCents)}
                  </td>
                  <td className="p-1.5 whitespace-nowrap">
                    {isWinner && !r.awaitingSubmission && <Badge tone="success">weekly winner</Badge>}
                    {r.isMaryRose && <Badge tone="info">Mary Rose 9-0</Badge>}
                    {r.isDenzil && <Badge tone="danger">Denzil 0-9</Badge>}
                    {r.onDenzilWatch && <Badge tone="warning">Denzil watch</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted">
        Dollars are gross loss only. Weekly pool winnings and awards are tracked separately — see{" "}
        <Link href="/standings" className="underline underline-offset-2">
          Standings
        </Link>
        .
      </p>
    </Shell>
  );
}

const BADGE_TONES = {
  success: "bg-success text-success-fg border-success-border",
  info: "bg-info text-info-fg border-info-border",
  danger: "bg-danger text-danger-fg border-danger-border",
  warning: "bg-warning text-warning-fg border-warning-border",
} as const;

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: React.ReactNode }) {
  return (
    <span className={`mr-1 inline-block rounded border px-1.5 py-0.5 text-xs ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

