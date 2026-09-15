import type { Sport } from "@/db/teams";
import type { BoardRule, Market } from "./rules";

// The season-level config grid: 18 weeks x 4 (sport, market) columns.
// Each cell is just a set of days — empty means "not included." No
// separate on/off flag per cell: a market is active for a week purely
// because its day set is non-empty. CFL isn't a grid column (the grid
// only covers what rule 11 actually needs); it's still configurable
// per-week on /commish/board/[weekId].

export const TOTAL_WEEKS = 18;

export type GridCellKey = "NFL_SPREAD" | "NFL_TOTAL" | "NCAA_SPREAD" | "NCAA_TOTAL";

export const GRID_CELL_KEYS: GridCellKey[] = [
  "NFL_SPREAD",
  "NFL_TOTAL",
  "NCAA_SPREAD",
  "NCAA_TOTAL",
];

export type GridWeek = Record<GridCellKey, number[]>;

export type BoardGrid = Record<number, GridWeek>;

export function emptyGridWeek(): GridWeek {
  return { NFL_SPREAD: [], NFL_TOTAL: [], NCAA_SPREAD: [], NCAA_TOTAL: [] };
}

export function emptyGrid(): BoardGrid {
  const grid: BoardGrid = {};
  for (let n = 1; n <= TOTAL_WEEKS; n++) grid[n] = emptyGridWeek();
  return grid;
}

/**
 * The sensible Denzil default: NFL SPREAD every week on Sun+Mon, NCAA
 * SPREAD every week on Sat, NFL TOTAL only on week 18 (Sat+Sun), NCAA
 * TOTAL never. Days are 0=Sun..6=Sat.
 */
export function defaultDenzilGrid(): BoardGrid {
  const grid: BoardGrid = {};
  for (let n = 1; n <= TOTAL_WEEKS; n++) {
    grid[n] = {
      NFL_SPREAD: [0, 1],
      NFL_TOTAL: n === TOTAL_WEEKS ? [0, 6] : [],
      NCAA_SPREAD: [6],
      NCAA_TOTAL: [],
    };
  }
  return grid;
}

export function cellKeyFor(sport: Sport, market: Market): GridCellKey | null {
  if (sport === "NFL" && market === "SPREAD") return "NFL_SPREAD";
  if (sport === "NFL" && market === "TOTAL") return "NFL_TOTAL";
  if (sport === "NCAA" && market === "SPREAD") return "NCAA_SPREAD";
  if (sport === "NCAA" && market === "TOTAL") return "NCAA_TOTAL";
  return null;
}

function sportAndMarketFor(key: GridCellKey): { sport: Sport; market: Market } {
  const [sport, market] = key.split("_") as [Sport, Market];
  return { sport, market };
}

/**
 * The rules the grid would produce for one week, given the season's
 * team defaults. This is what /commish/config saves into
 * week_board_config.rules, and what the per-week badge compares
 * against to detect a manual override.
 */
export function rulesForWeek(
  grid: BoardGrid,
  weekNumber: number,
  nflTeamIds: number[] | null,
  ncaaTeamIds: number[] | null,
): BoardRule[] {
  const cell = grid[weekNumber] ?? emptyGridWeek();
  const rules: BoardRule[] = [];

  for (const key of GRID_CELL_KEYS) {
    const days = cell[key];
    if (!days || days.length === 0) continue;

    const { sport, market } = sportAndMarketFor(key);
    rules.push({
      sport,
      market,
      daysOfWeek: [...days].sort((a, b) => a - b),
      includeTeamIds: sport === "NFL" ? nflTeamIds : ncaaTeamIds,
      excludeTeamIds: null,
    });
  }

  return rules;
}

function normalizeRule(rule: BoardRule) {
  return {
    sport: rule.sport,
    market: rule.market,
    daysOfWeek: [...rule.daysOfWeek].sort((a, b) => a - b),
    includeTeamIds: rule.includeTeamIds
      ? [...rule.includeTeamIds].sort((a, b) => a - b)
      : null,
    excludeTeamIds: rule.excludeTeamIds
      ? [...rule.excludeTeamIds].sort((a, b) => a - b)
      : null,
  };
}

/** Order- and array-order-independent rule set comparison. */
export function rulesEqual(a: BoardRule[], b: BoardRule[]): boolean {
  const normalize = (rules: BoardRule[]) =>
    rules
      .map(normalizeRule)
      .sort((x, y) => `${x.sport}_${x.market}`.localeCompare(`${y.sport}_${y.market}`));

  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
