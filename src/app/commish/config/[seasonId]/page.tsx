import { asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { season, seasonBoardDefaults, team, week, weekBoardConfig } from "@/db/schema";
import {
  defaultDenzilGrid,
  rulesEqual,
  rulesForWeek,
  TOTAL_WEEKS,
  type BoardGrid,
} from "@/lib/board/grid";
import type { BoardRule } from "@/lib/board/rules";
import { BoardConfigGrid, type WeekMeta } from "./BoardConfigGrid";
import { GenerateWeeksForm } from "./GenerateWeeksForm";
import { generateWeeksAction, saveGridAction, updateWeekTypeAction } from "./actions";

export default async function SeasonConfigPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId: seasonIdParam } = await params;
  const seasonId = Number(seasonIdParam);

  if (!Number.isInteger(seasonId)) {
    notFound();
  }

  const [seasonRow] = await db
    .select()
    .from(season)
    .where(eq(season.id, seasonId))
    .limit(1);

  if (!seasonRow) {
    notFound();
  }

  const [defaultsRow] = await db
    .select()
    .from(seasonBoardDefaults)
    .where(eq(seasonBoardDefaults.seasonId, seasonId))
    .limit(1);

  const nflTeamIds = defaultsRow?.nflTeamIds ?? null;
  const ncaaTeamIds = defaultsRow?.ncaaTeamIds ?? null;
  const grid = (defaultsRow?.grid as BoardGrid | undefined) ?? defaultDenzilGrid();

  const allTeams = await db
    .select({ id: team.id, sport: team.sport, canonicalName: team.canonicalName })
    .from(team)
    .orderBy(asc(team.canonicalName));

  const nflTeams = allTeams.filter((t) => t.sport === "NFL");
  const ncaaTeams = allTeams.filter((t) => t.sport === "NCAA");

  const weeks = await db
    .select({ id: week.id, number: week.number, status: week.status, type: week.type })
    .from(week)
    .where(eq(week.seasonId, seasonId));

  const weekByNumber = new Map(weeks.map((w) => [w.number, w]));

  const weekIds = weeks.map((w) => w.id);
  const configs =
    weekIds.length > 0
      ? await db
          .select()
          .from(weekBoardConfig)
          .where(inArray(weekBoardConfig.weekId, weekIds))
      : [];
  const configByWeekId = new Map(
    configs.map((c) => [c.weekId, c.rules as BoardRule[]]),
  );

  const weekMeta: WeekMeta[] = Array.from({ length: TOTAL_WEEKS }, (_, i) => {
    const number = i + 1;
    const weekRow = weekByNumber.get(number);
    const locked = weekRow ? weekRow.status !== "upcoming" : false;
    const actualRules = weekRow ? (configByWeekId.get(weekRow.id) ?? []) : [];
    const producedRules = rulesForWeek(grid, number, nflTeamIds, ncaaTeamIds);
    const hasOverride = weekRow
      ? !rulesEqual(actualRules, producedRules)
      : false;

    return {
      number,
      weekId: weekRow?.id ?? null,
      status: weekRow?.status ?? null,
      type: weekRow?.type ?? null,
      locked,
      hasOverride,
    };
  });

  return (
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 1200 }}>
      <h1>Board Config — {seasonRow.label}</h1>
      <p>
        Season defaults for the board builder. Individual weeks can still be
        overridden on their own board page — a ⚑ marks any week that already
        differs from what this grid would produce.
      </p>

      {weeks.length < TOTAL_WEEKS && (
        <GenerateWeeksForm
          generateWeeksAction={generateWeeksAction.bind(null, seasonId)}
        />
      )}

      <BoardConfigGrid
        initialNflTeamIds={nflTeamIds}
        initialNcaaTeamIds={ncaaTeamIds}
        initialGrid={grid}
        nflTeams={nflTeams}
        ncaaTeams={ncaaTeams}
        weekMeta={weekMeta}
        saveGridAction={saveGridAction.bind(null, seasonId)}
        updateWeekTypeAction={updateWeekTypeAction}
      />
    </main>
  );
}
