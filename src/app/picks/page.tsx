import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { getCurrentWeek } from "@/db/weeks";
import { game, pick, submission, team, week } from "@/db/schema";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";
import { PicksForm, type BoardGame } from "./PicksForm";
import { submitPicksAction } from "./actions";

const SPEED_ELIGIBLE_MAX_WEEK = 11;

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

export default async function PicksPage() {
  const current = await getCurrentPlayer();

  if (!current) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
        <h1>Make Picks</h1>
        <p>We couldn&apos;t find a player record for your account.</p>
      </main>
    );
  }

  const { seasonEntry } = current;
  if (!seasonEntry) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
        <h1>Make Picks</h1>
        <p>You&apos;re not entered in the active season.</p>
      </main>
    );
  }

  const currentWeek = await getCurrentWeek(seasonEntry.seasonId);

  if (!currentWeek || currentWeek.status !== "open") {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
        <h1>Make Picks</h1>
        <p>There&apos;s no open week right now.</p>
      </main>
    );
  }

  const homeTeam = alias(team, "home_team");
  const awayTeam = alias(team, "away_team");
  const favoriteTeam = alias(team, "favorite_team");

  const [existingSubmission] = await db
    .select()
    .from(submission)
    .where(
      and(
        eq(submission.seasonEntryId, seasonEntry.id),
        eq(submission.weekId, currentWeek.id),
      ),
    )
    .limit(1);

  if (existingSubmission) {
    const picks = await db
      .select({
        id: pick.id,
        sport: game.sport,
        market: game.market,
        selection: pick.selection,
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
          eq(pick.weekId, currentWeek.id),
        ),
      )
      .orderBy(asc(game.sport), asc(game.kickoffAt));

    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 720 }}>
        <h1>Week {currentWeek.number} — Your Picks</h1>
        <p>
          Submitted {ET_DATE_FORMAT.format(existingSubmission.submittedAt)}
          {existingSubmission.isSpeedDeclared ? " — speed week declared" : ""}
        </p>
        <p style={{ fontStyle: "italic" }}>
          Picks are final. Only a commissioner can change them.
        </p>
        <ul>
          {picks.map((p) => (
            <li key={p.id}>
              [{p.sport}] {p.awayName} @ {p.homeName} — {formatLine(p)} — picked{" "}
              <strong>{p.selection}</strong>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const boardGames = await db
    .select({
      id: game.id,
      sport: game.sport,
      market: game.market,
      kickoffAt: game.kickoffAt,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      favoriteTeamId: game.favoriteTeamId,
      spread: game.spread,
      totalPoints: game.totalPoints,
      homeName: homeTeam.canonicalName,
      awayName: awayTeam.canonicalName,
    })
    .from(game)
    .innerJoin(homeTeam, eq(game.homeTeamId, homeTeam.id))
    .innerJoin(awayTeam, eq(game.awayTeamId, awayTeam.id))
    .where(and(eq(game.weekId, currentWeek.id), eq(game.isOnBoard, true)))
    .orderBy(asc(game.sport), asc(game.kickoffAt));

  const speedEligible = currentWeek.number <= SPEED_ELIGIBLE_MAX_WEEK;

  const priorSpeedRows = await db
    .select({ id: submission.id })
    .from(submission)
    .innerJoin(week, eq(submission.weekId, week.id))
    .where(
      and(
        eq(submission.seasonEntryId, seasonEntry.id),
        eq(week.seasonId, seasonEntry.seasonId),
        eq(submission.isSpeedDeclared, true),
      ),
    );
  const hasUsedSpeed = priorSpeedRows.length > 0;
  const forcedSpeed =
    currentWeek.number === SPEED_ELIGIBLE_MAX_WEEK && !hasUsedSpeed;

  return (
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 900 }}>
      <h1>Make Picks — Week {currentWeek.number}</h1>
      <PicksForm
        weekId={currentWeek.id}
        games={boardGames as BoardGame[]}
        speedEligible={speedEligible}
        forcedSpeed={forcedSpeed}
        hasUsedSpeed={hasUsedSpeed}
        submitPicksAction={submitPicksAction.bind(null, currentWeek.id)}
      />
    </main>
  );
}
