import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { game, pick, submission, team, week, weekResult } from "@/db/schema";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";

const ET_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function formatLine(row: {
  market: "SPREAD" | "TOTAL";
  spread: string | null;
  totalPoints: string | null;
  favoriteName: string | null;
}): string {
  if (row.market === "SPREAD") {
    return `${row.favoriteName ?? "?"} -${row.spread ?? "?"}`;
  }
  return `O/U ${row.totalPoints ?? "?"}`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function MyPicksPage() {
  const current = await getCurrentPlayer();

  if (!current) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
        <h1>My Picks</h1>
        <p>We couldn&apos;t find a player record for your account.</p>
      </main>
    );
  }

  const { seasonEntry } = current;
  if (!seasonEntry) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
        <h1>My Picks</h1>
        <p>You&apos;re not entered in the active season.</p>
      </main>
    );
  }

  const weeks = await db
    .select()
    .from(week)
    .where(eq(week.seasonId, seasonEntry.seasonId))
    .orderBy(asc(week.number));

  const homeTeam = alias(team, "home_team");
  const awayTeam = alias(team, "away_team");
  const favoriteTeam = alias(team, "favorite_team");

  const weekData = await Promise.all(
    weeks.map(async (w) => {
      const [submissionRow] = await db
        .select()
        .from(submission)
        .where(
          and(
            eq(submission.seasonEntryId, seasonEntry.id),
            eq(submission.weekId, w.id),
          ),
        )
        .limit(1);

      const picks = submissionRow
        ? await db
            .select({
              id: pick.id,
              selection: pick.selection,
              market: game.market,
              spread: game.spread,
              totalPoints: game.totalPoints,
              homeName: homeTeam.canonicalName,
              awayName: awayTeam.canonicalName,
              favoriteName: favoriteTeam.canonicalName,
            })
            .from(pick)
            .innerJoin(game, eq(pick.gameId, game.id))
            .innerJoin(homeTeam, eq(game.homeTeamId, homeTeam.id))
            .innerJoin(awayTeam, eq(game.awayTeamId, awayTeam.id))
            .leftJoin(favoriteTeam, eq(game.favoriteTeamId, favoriteTeam.id))
            .where(
              and(
                eq(pick.seasonEntryId, seasonEntry.id),
                eq(pick.weekId, w.id),
              ),
            )
            .orderBy(asc(game.kickoffAt))
        : [];

      const [result] = await db
        .select()
        .from(weekResult)
        .where(
          and(
            eq(weekResult.seasonEntryId, seasonEntry.id),
            eq(weekResult.weekId, w.id),
          ),
        )
        .limit(1);

      return { week: w, submission: submissionRow, picks, result };
    }),
  );

  return (
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 800 }}>
      <h1>My Picks — {seasonEntry.displayName}</h1>

      {weekData.map(({ week: w, submission: submissionRow, picks, result }) => (
        <section key={w.id} style={{ marginBottom: "1.5rem" }}>
          <h2>
            Week {w.number} — {w.type} ({w.status})
          </h2>

          {submissionRow ? (
            <>
              <p>
                Submitted {ET_DATE_FORMAT.format(submissionRow.submittedAt)}
                {submissionRow.isSpeedDeclared ? " — speed week declared" : ""}
              </p>
              {result && (
                <p style={{ fontWeight: "bold" }}>
                  Result: {result.wins}-{result.losses}
                  {result.pushes > 0 ? `-${result.pushes}` : ""} —{" "}
                  {formatCents(result.grossLossCents)} lost
                </p>
              )}
              <ul>
                {picks.map((p) => (
                  <li key={p.id}>
                    {p.awayName} @ {p.homeName} — {formatLine(p)} — picked{" "}
                    <strong>{p.selection}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p style={{ color: "#999" }}>No submission.</p>
          )}
        </section>
      ))}
    </main>
  );
}
