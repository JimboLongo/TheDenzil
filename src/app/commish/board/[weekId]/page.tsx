import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { boardOverride, game, team, week, weekBoardConfig } from "@/db/schema";
import type { Sport } from "@/db/teams";
import { boardSizeWarning, type BoardRule } from "@/lib/board/rules";
import { RulesEditor, type GameRow } from "./RulesEditor";
import {
  createManualGameAction,
  publishBoardAction,
  saveRulesAction,
  setOverrideAction,
  takeSnapshotAction,
} from "./actions";

const SPORT_ORDER: Sport[] = ["NFL", "NCAA", "CFL"];

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

export default async function BoardPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  const { weekId: weekIdParam } = await params;
  const weekId = Number(weekIdParam);

  if (!Number.isInteger(weekId)) {
    notFound();
  }

  const [weekRow] = await db
    .select()
    .from(week)
    .where(eq(week.id, weekId))
    .limit(1);

  if (!weekRow) {
    notFound();
  }

  const homeTeam = alias(team, "home_team");
  const awayTeam = alias(team, "away_team");
  const favoriteTeam = alias(team, "favorite_team");

  const rows = await db
    .select({
      id: game.id,
      sport: game.sport,
      kickoffAt: game.kickoffAt,
      market: game.market,
      spread: game.spread,
      totalPoints: game.totalPoints,
      source: game.source,
      sourceBook: game.sourceBook,
      externalEventId: game.externalEventId,
      isOnBoard: game.isOnBoard,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeName: homeTeam.canonicalName,
      awayName: awayTeam.canonicalName,
      favoriteName: favoriteTeam.canonicalName,
    })
    .from(game)
    .innerJoin(homeTeam, eq(game.homeTeamId, homeTeam.id))
    .innerJoin(awayTeam, eq(game.awayTeamId, awayTeam.id))
    .leftJoin(favoriteTeam, eq(game.favoriteTeamId, favoriteTeam.id))
    .where(eq(game.weekId, weekId))
    .orderBy(asc(game.kickoffAt), asc(game.id));

  const isPublished = weekRow.linesPublishedAt !== null;

  const boundSaveRules = saveRulesAction.bind(null, weekId);
  const boundPublish = publishBoardAction.bind(null, weekId);
  const boundSetOverride = setOverrideAction.bind(null, weekId);

  if (isPublished) {
    const onBoardCount = rows.filter((r) => r.isOnBoard).length;
    const bySport = new Map<Sport, typeof rows>();
    for (const sport of SPORT_ORDER) bySport.set(sport, []);
    for (const row of rows) {
      bySport.get(row.sport)?.push(row);
    }

    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 960 }}>
<h1>
          Week {weekRow.number} Board — {weekRow.type}
        </h1>
        <p>
          Published: {ET_DATE_FORMAT.format(weekRow.linesPublishedAt!)} — rules
          are locked. Only overrides (each writes a ruling) can change what
          follows.
        </p>
        <p style={{ fontWeight: "bold" }}>{onBoardCount} game(s) on board</p>
        {boardSizeWarning(onBoardCount) && (
          <p style={{ color: "#8a6d00" }}>{boardSizeWarning(onBoardCount)}</p>
        )}

        {SPORT_ORDER.map((sport) => {
          const sportRows = bySport.get(sport) ?? [];
          if (sportRows.length === 0) return null;
          return (
            <section key={sport} style={{ marginBottom: "2rem" }}>
              <h2>
                {sport} ({sportRows.length})
              </h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                    <th>Matchup</th>
                    <th>Kickoff (ET)</th>
                    <th>Market</th>
                    <th>Line</th>
                    <th>Book</th>
                    <th>On board</th>
                    <th>Override</th>
                  </tr>
                </thead>
                <tbody>
                  {sportRows.map((row) => (
                    <tr key={row.id} style={{ borderBottom: "1px solid #eee" }}>
                      <td>
                        {row.awayName} @ {row.homeName}
                      </td>
                      <td>{ET_DATE_FORMAT.format(row.kickoffAt)}</td>
                      <td>{row.market}</td>
                      <td>{formatLine(row)}</td>
                      <td>{row.sourceBook ?? "manual"}</td>
                      <td>{row.isOnBoard ? "yes" : "no"}</td>
                      <td>
                        <form action={boundSetOverride.bind(null, row.id, "INCLUDE")} style={{ display: "inline" }}>
                          <button type="submit">Force include</button>
                        </form>{" "}
                        <form action={boundSetOverride.bind(null, row.id, "EXCLUDE")} style={{ display: "inline" }}>
                          <button type="submit">Force exclude</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </main>
    );
  }

  const [config] = await db
    .select()
    .from(weekBoardConfig)
    .where(eq(weekBoardConfig.weekId, weekId))
    .limit(1);
  const initialRules = (config?.rules as BoardRule[] | undefined) ?? [];

  const overrideRows = await db
    .select({ gameId: boardOverride.gameId, action: boardOverride.action })
    .from(boardOverride)
    .where(eq(boardOverride.weekId, weekId));

  const teamsBySport: Record<Sport, { id: number; canonicalName: string }[]> = {
    NFL: [],
    NCAA: [],
    CFL: [],
  };
  const allTeams = await db
    .select({ id: team.id, sport: team.sport, canonicalName: team.canonicalName })
    .from(team)
    .orderBy(asc(team.canonicalName));
  for (const t of allTeams) teamsBySport[t.sport].push(t);

  const gamesForClient: GameRow[] = rows.map((r) => ({
    id: r.id,
    sport: r.sport,
    market: r.market,
    kickoffAt: r.kickoffAt,
    homeTeamId: r.homeTeamId,
    awayTeamId: r.awayTeamId,
    source: r.source,
    homeName: r.homeName,
    awayName: r.awayName,
    favoriteName: r.favoriteName,
    spread: r.spread,
    totalPoints: r.totalPoints,
    sourceBook: r.sourceBook,
  }));

  return (
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 960 }}>
      <h1>
        Week {weekRow.number} Board — {weekRow.type}
      </h1>
      <p>
        Line snapshot:{" "}
        {weekRow.lineSnapshotAt ? ET_DATE_FORMAT.format(weekRow.lineSnapshotAt) : "never"}
        {" · "}
        {rows.length} snapshot game(s) in the candidate pool. Not published —
        board membership below is derived from rules, live.
      </p>

      <form action={takeSnapshotAction.bind(null, weekId)} style={{ marginBottom: "1.5rem" }}>
        <button type="submit">Take snapshot</button>
      </form>

      <RulesEditor
        weekId={weekId}
        initialRules={initialRules}
        games={gamesForClient}
        teamsBySport={teamsBySport}
        initialOverrides={overrideRows}
        saveRulesAction={boundSaveRules}
        publishBoardAction={boundPublish}
        setOverrideAction={boundSetOverride}
      />

      <section style={{ marginTop: "2rem" }}>
        <h2>Add a manual game</h2>
        <form
          action={createManualGameAction.bind(null, weekId)}
          style={{ display: "grid", gap: "0.5rem", maxWidth: 400 }}
        >
          <label>
            Sport
            <select name="sport" defaultValue="NCAA">
              <option value="NFL">NFL</option>
              <option value="NCAA">NCAA</option>
              <option value="CFL">CFL</option>
            </select>
          </label>
          <label>
            Home team
            <input type="text" name="homeTeamName" required />
          </label>
          <label>
            Away team
            <input type="text" name="awayTeamName" required />
          </label>
          <label>
            Kickoff
            <input type="datetime-local" name="kickoffAt" required />
          </label>
          <label>
            Market
            <select name="market" defaultValue="SPREAD">
              <option value="SPREAD">SPREAD</option>
              <option value="TOTAL">TOTAL</option>
            </select>
          </label>
          <label>
            Favorite team (spread only)
            <input type="text" name="favoriteTeamName" />
          </label>
          <label>
            Spread
            <input type="number" step="0.5" name="spread" />
          </label>
          <label>
            Total points
            <input type="number" step="0.5" name="totalPoints" />
          </label>
          <button type="submit">Add game</button>
        </form>
      </section>
    </main>
  );
}
