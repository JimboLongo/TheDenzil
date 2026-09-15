import type { SettlementConfig } from "./config";

/**
 * Rate assignment — spec section 3, Settlement item 1:
 * speed if declared or week 18; else handicap if week 12-17 and in the
 * leading eight by cumulative gross loss entering the week, ties at 8th
 * included; else base. Speed replaces the handicap, it never stacks.
 */
export type RateKind = "base" | "handicap" | "speed";
export type Rate = { kind: RateKind; cents: number };

/**
 * The leading group entering a week, by cumulative gross loss ascending.
 * "Ties at 8th included" means this can return more than leaderCount
 * entries: take the value sitting at the cutoff, then admit everyone at
 * or below it.
 */
export function leadingGroup(
  cumulativeByEntry: Map<number, number>,
  leaderCount: number,
): Set<number> {
  const sorted = [...cumulativeByEntry.entries()].sort((a, b) => a[1] - b[1]);
  if (sorted.length === 0) return new Set();

  const cutoffIndex = Math.min(leaderCount, sorted.length) - 1;
  const cutoffValue = sorted[cutoffIndex][1];
  return new Set(sorted.filter(([, cumulative]) => cumulative <= cutoffValue).map(([id]) => id));
}

export function assignRate(args: {
  weekNumber: number;
  isSpeedWeekForAll: boolean;
  isSpeedDeclared: boolean;
  inLeadingGroup: boolean;
  config: SettlementConfig;
}): Rate {
  const { weekNumber, isSpeedWeekForAll, isSpeedDeclared, inLeadingGroup, config } = args;

  // "declared or week 18" — the week flag is the data-driven form of
  // the same rule, so either satisfies it.
  if (isSpeedDeclared || isSpeedWeekForAll || weekNumber === config.finalSpeedWeek) {
    return { kind: "speed", cents: config.speedLossCents };
  }

  const [firstLeaderWeek, lastLeaderWeek] = config.leaderWeekRange;
  if (weekNumber >= firstLeaderWeek && weekNumber <= lastLeaderWeek && inLeadingGroup) {
    return { kind: "handicap", cents: config.leaderLossCents };
  }

  return { kind: "base", cents: config.baseLossCents };
}
