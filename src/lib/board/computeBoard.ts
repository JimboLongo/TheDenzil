import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boardOverride, game, weekBoardConfig } from "@/db/schema";
import {
  computeBoardIds,
  type BoardRule,
  type OverrideAction,
} from "./rules";

export async function computeBoard(weekId: number): Promise<number[]> {
  const [config] = await db
    .select()
    .from(weekBoardConfig)
    .where(eq(weekBoardConfig.weekId, weekId))
    .limit(1);

  const rules = (config?.rules as BoardRule[] | undefined) ?? [];

  const games = await db
    .select({
      id: game.id,
      sport: game.sport,
      market: game.market,
      kickoffAt: game.kickoffAt,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      source: game.source,
    })
    .from(game)
    .where(eq(game.weekId, weekId));

  const overrideRows = await db
    .select()
    .from(boardOverride)
    .where(eq(boardOverride.weekId, weekId));

  const overrides = new Map<number, OverrideAction>(
    overrideRows.map((o) => [o.gameId, o.action]),
  );

  return computeBoardIds(games, rules, overrides);
}
