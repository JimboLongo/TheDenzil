import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Link from "next/link";
import { db } from "@/db";
import { getCurrentWeek } from "@/db/weeks";
import { game, pick, submission, team } from "@/db/schema";
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

export default async function HomePage() {
  const current = await getCurrentPlayer();

  if (!current) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
        <h1>Welcome</h1>
        <p>
          We couldn&apos;t find a player record for your account. Contact
          your commissioner.
        </p>
      </main>
    );
  }

  const { player, seasonEntry } = current;

  if (!seasonEntry) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem" }}>
        <h1>Hi, {player.currentDisplayName}</h1>
        <p>You&apos;re not entered in the active season yet.</p>
      </main>
    );
  }

  const currentWeek = await getCurrentWeek(seasonEntry.seasonId);

  type SlipPick = {
    id: number;
    market: "SPREAD" | "TOTAL";
    selection: string;
    homeName: string;
    awayName: string;
  };

  let submittedAt: Date | null = null;
  let slipPicks: SlipPick[] = [];

  if (currentWeek) {
    const [submissionRow] = await db
      .select()
      .from(submission)
      .where(
        and(
          eq(submission.seasonEntryId, seasonEntry.id),
          eq(submission.weekId, currentWeek.id),
        ),
      )
      .limit(1);

    if (submissionRow) {
      submittedAt = submissionRow.submittedAt;

      const homeTeam = alias(team, "home_team");
      const awayTeam = alias(team, "away_team");

      slipPicks = await db
        .select({
          id: pick.id,
          market: game.market,
          selection: pick.selection,
          homeName: homeTeam.canonicalName,
          awayName: awayTeam.canonicalName,
        })
        .from(pick)
        .innerJoin(game, eq(pick.gameId, game.id))
        .innerJoin(homeTeam, eq(game.homeTeamId, homeTeam.id))
        .innerJoin(awayTeam, eq(game.awayTeamId, awayTeam.id))
        .where(
          and(
            eq(pick.seasonEntryId, seasonEntry.id),
            eq(pick.weekId, currentWeek.id),
          ),
        );
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 720 }}>
      <h1>Welcome, {seasonEntry.displayName}</h1>
      <p>
        {currentWeek
          ? `Week ${currentWeek.number} — ${currentWeek.type} (${currentWeek.status})`
          : "No current week — nothing open, settling, or final for this season yet."}
      </p>

      {currentWeek &&
        (submittedAt ? (
          <section>
            <h2>Your picks — Week {currentWeek.number}</h2>
            <p>Submitted {ET_DATE_FORMAT.format(submittedAt)}</p>
            <ul>
              {slipPicks.map((p) => (
                <li key={p.id}>
                  {p.awayName} @ {p.homeName} — {p.market} {p.selection}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p>
            <Link href="/picks" style={{ fontWeight: "bold", fontSize: "1.2em" }}>
              Make your picks for Week {currentWeek.number} →
            </Link>
          </p>
        ))}

      <nav style={{ display: "grid", gap: "0.5rem", marginTop: "1.5rem" }}>
        <Link href="/standings">Standings</Link>
        <Link href="/weekly-results">Weekly Results</Link>
        <Link href="/league-picks">League Picks</Link>
        {seasonEntry.role === "commish" && currentWeek && (
          <Link href={`/commish/board/${currentWeek.id}`}>
            Board Builder (commish)
          </Link>
        )}
        {seasonEntry.role === "commish" && (
          <Link href={`/commish/config/${seasonEntry.seasonId}`}>
            Season Board Config (commish)
          </Link>
        )}
      </nav>
    </main>
  );
}
