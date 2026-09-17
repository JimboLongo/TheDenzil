import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { boardOverride, game, team, week } from "@/db/schema";
import type { Sport } from "@/db/teams";
import { BoardBuilder, type WeekOption } from "./BoardBuilder";
import { RulesEditor, type GameRow } from "./RulesEditor";
import {
  clearOverrideAction,
  loadWeekBoard,
  loadWeekBoardAction,
  publishBoardAction,
  saveRulesAction,
  refreshScheduleAction,
  saveScheduleAction,
  setOverrideAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Board Builder. The week selector switches weeks through a server action
 * rather than a route change, so the URL stays put — the weekId in the
 * path is only the entry point.
 */
export default async function BoardPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  const { weekId: weekIdParam } = await params;
  const weekId = Number(weekIdParam);
  if (!Number.isInteger(weekId)) notFound();

  const [weekRow] = await db.select().from(week).where(eq(week.id, weekId)).limit(1);
  if (!weekRow) notFound();

  const weekRows = await db
    .select({ id: week.id, number: week.number, status: week.status, type: week.type })
    .from(week)
    .where(eq(week.seasonId, weekRow.seasonId))
    .orderBy(asc(week.number));
  const weeks: WeekOption[] = weekRows;

  const initial = await loadWeekBoard(weekId);

  // The rules editor keeps its own shape; it's rendered collapsed inside
  // the builder, since filters are the bulk tool and the per-game
  // checkboxes are for exceptions to them.
  const homeTeam = alias(team, "home_team");
  const awayTeam = alias(team, "away_team");
  const favoriteTeam = alias(team, "favorite_team");

  const rows = await db
    .select({
      id: game.id,
      sport: game.sport,
      market: game.market,
      kickoffAt: game.kickoffAt,
      spread: game.spread,
      totalPoints: game.totalPoints,
      source: game.source,
      sourceBook: game.sourceBook,
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
    .where(eq(team.isFixture, false))
    .orderBy(asc(team.canonicalName));
  for (const t of allTeams) teamsBySport[t.sport].push(t);

  const gamesForClient: GameRow[] = rows as GameRow[];

  return (
    <main className="flex max-w-5xl flex-col gap-3 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Board Builder</h1>

      <BoardBuilder
        weeks={weeks}
        initial={initial}
        loadWeek={loadWeekBoardAction}
        setOverride={setOverrideAction}
        clearOverride={clearOverrideAction}
        saveSchedule={saveScheduleAction}
        refreshSchedule={refreshScheduleAction}
        rulesEditor={
          <RulesEditor
            weekId={weekId}
            initialRules={initial.rules}
            games={gamesForClient}
            teamsBySport={teamsBySport}
            initialOverrides={overrideRows}
            saveRulesAction={saveRulesAction.bind(null, weekId)}
            publishBoardAction={publishBoardAction.bind(null, weekId)}
            setOverrideAction={setOverrideAction.bind(null, weekId)}
          />
        }
      />
    </main>
  );
}
