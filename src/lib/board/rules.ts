import type { Sport } from "@/db/teams";

// Pure, DB-free logic — safe to import from a Client Component so the
// live rules-editor preview and the server's computeBoard() agree by
// construction instead of by two hand-kept-in-sync implementations.

export type Market = "SPREAD" | "TOTAL";

// One rule per (sport, market) — not one rule per sport covering both
// markets. A single sport can need different days for different
// markets in the same week (rule 11: week 18's NFL TOTAL runs Sat+Sun
// while NFL SPREAD stays Sun+Mon everywhere, including week 18). A
// shared days array per sport can't represent that.
export type BoardRule = {
  sport: Sport;
  market: Market;
  daysOfWeek: number[];
  includeTeamIds: number[] | null;
  excludeTeamIds: number[] | null;
};

export type OverrideAction = "INCLUDE" | "EXCLUDE";

const LEAGUE_TIME_ZONE = "America/New_York";
const WEEKDAY_INDEX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Day-of-week in the league's local time, not UTC — a Monday night
 * kickoff at 8:15pm ET is already Tuesday in UTC.
 */
export function dayOfWeekInLeagueTime(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: LEAGUE_TIME_ZONE,
    weekday: "short",
  }).format(date);
  return WEEKDAY_INDEX.indexOf(weekday);
}

export type RuleMatchableGame = {
  sport: Sport;
  market: Market;
  kickoffAt: Date;
  homeTeamId: number;
  awayTeamId: number;
};

/**
 * includeTeamIds/excludeTeamIds match on EITHER participant, not both —
 * the board is "most games," and a team list is for trimming weak
 * matchups ("all NCAA except FCS opponents"), not restricting to a
 * narrow allowlist. Exclude wins over include. Forcing a specific
 * matchup on regardless of who's playing is what board_override is for.
 */
export function matchesRule(
  game: RuleMatchableGame,
  rule: BoardRule,
): boolean {
  if (rule.sport !== game.sport) return false;
  if (rule.market !== game.market) return false;
  if (!rule.daysOfWeek.includes(dayOfWeekInLeagueTime(game.kickoffAt))) {
    return false;
  }
  if (
    rule.excludeTeamIds !== null &&
    (rule.excludeTeamIds.includes(game.homeTeamId) ||
      rule.excludeTeamIds.includes(game.awayTeamId))
  ) {
    return false;
  }
  if (
    rule.includeTeamIds !== null &&
    !rule.includeTeamIds.includes(game.homeTeamId) &&
    !rule.includeTeamIds.includes(game.awayTeamId)
  ) {
    return false;
  }
  return true;
}

export function matchesAnyRule(
  game: RuleMatchableGame,
  rules: BoardRule[],
): boolean {
  return rules.some((rule) => matchesRule(game, rule));
}

export type OverridableGame = RuleMatchableGame & {
  id: number;
  source: "odds_api" | "manual";
};

/**
 * Board = every snapshot game matching any rule, plus INCLUDE overrides,
 * minus EXCLUDE overrides. Manual games are always included (a
 * commissioner typed them in on purpose).
 */
export function computeBoardIds(
  games: OverridableGame[],
  rules: BoardRule[],
  overrides: Map<number, OverrideAction>,
): number[] {
  const result: number[] = [];
  for (const g of games) {
    const override = overrides.get(g.id);
    if (override === "EXCLUDE") continue;
    if (override === "INCLUDE") {
      result.push(g.id);
      continue;
    }
    if (g.source === "manual") {
      result.push(g.id);
      continue;
    }
    if (matchesAnyRule(g, rules)) result.push(g.id);
  }
  return result;
}

// Rule 3 expects a 20-40 game board. Outside [MIN, MAX] usually means a
// rule is misconfigured, not that the commissioner wants a tiny or huge
// board, so this is a warning everywhere the board size is shown — not
// a block. A genuinely empty board is a harder failure, handled
// separately (publishing it leaves players nothing to pick).
export const MIN_RECOMMENDED_BOARD_SIZE = 15;
export const MAX_RECOMMENDED_BOARD_SIZE = 50;

export function boardSizeWarning(count: number): string | null {
  if (count === 0) return null;
  if (
    count < MIN_RECOMMENDED_BOARD_SIZE ||
    count > MAX_RECOMMENDED_BOARD_SIZE
  ) {
    return `${count} game(s) — rule 3 expects 20-40. Outside that range usually means a rule is misconfigured.`;
  }
  return null;
}
