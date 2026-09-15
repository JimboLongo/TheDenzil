import type { SettlementConfig } from "./config";
import { gradePick, type SettlementGame, type SettlementPick } from "./grade";
import type { Rate } from "./rates";

/**
 * One week of settlement — spec section 3, Settlement items 4 through 8.
 * Pure: takes the week's picks, games and already-assigned rates and
 * returns the result. Rates come in from settleSeason because item 1
 * depends on standings entering the week, which only the season-level
 * replay knows ("Scoring is a pure function, replayed in week order").
 *
 * Never reads a stored dollar figure. Every number here is computed
 * from picks, games, and config.
 */
export type WeekPlayerResult = {
  seasonEntryId: number;
  noShow: boolean;
  wins: number;
  losses: number;
  pushes: number;
  rateKind: Rate["kind"];
  rateAppliedCents: number;
  grossLossCents: number;
  weeklyPoolContributionCents: number;
  denzilAwardCents: number;
  denzilCapped: boolean;
  denzilCountAfter: number;
  weeklyWinShareCents: number;
  isMaryRose: boolean;
};

export type WeekSettlement = {
  weekId: number;
  weekNumber: number;
  players: WeekPlayerResult[];
  weeklyPoolCents: number;
  denzilPaidCents: number;
  weeklyWinnerEntryIds: number[];
  weeklyWinnerGrossLossCents: number;
  weeklyWinShareCents: number;
  pennyRemainderToSeasonPoolCents: number;
};

export type SettleWeekInput = {
  weekId: number;
  weekNumber: number;
  seasonEntryIds: number[];
  /** Absent entry = no submission that week (item 4). */
  submissionByEntry: Map<number, { isSpeedDeclared: boolean }>;
  picksByEntry: Map<number, SettlementPick[]>;
  gamesById: Map<number, SettlementGame>;
  rateByEntry: Map<number, Rate>;
  /** Denzil Awards already paid to each entry earlier this season. */
  denzilCountByEntry: Map<number, number>;
  config: SettlementConfig;
};

export function settleWeek(input: SettleWeekInput): WeekSettlement {
  const {
    weekId,
    weekNumber,
    seasonEntryIds,
    submissionByEntry,
    picksByEntry,
    gamesById,
    rateByEntry,
    denzilCountByEntry,
    config,
  } = input;

  const players: WeekPlayerResult[] = [];
  let weeklyPoolCents = 0;

  for (const seasonEntryId of seasonEntryIds) {
    const rate = rateByEntry.get(seasonEntryId);
    if (!rate) throw new Error(`no rate assigned for entry ${seasonEntryId} in week ${weekNumber}`);

    const submission = submissionByEntry.get(seasonEntryId);
    const noShow = submission === undefined;

    let wins = 0;
    let losses = 0;
    let pushes = 0;

    if (noShow) {
      // Item 4: no submission is nine losses at that entry's rate.
      losses = config.picksPerWeek;
    } else {
      for (const pick of picksByEntry.get(seasonEntryId) ?? []) {
        const game = gamesById.get(pick.gameId);
        if (!game) throw new Error(`pick references game ${pick.gameId}, which is not in week ${weekNumber}`);
        const grade = gradePick(pick, game);
        if (grade === "WIN") wins++;
        else if (grade === "LOSS") losses++;
        else pushes++;
      }
    }

    const grossLossCents = losses * rate.cents;
    // Item 5: the weekly pool takes a flat $1.75 per loss whatever the
    // player's own rate was; the excess above it is season-pool money.
    const weeklyPoolContributionCents = losses * config.weeklyPoolPerLossCents;
    weeklyPoolCents += weeklyPoolContributionCents;

    players.push({
      seasonEntryId,
      noShow,
      wins,
      losses,
      pushes,
      rateKind: rate.kind,
      rateAppliedCents: rate.cents,
      grossLossCents,
      weeklyPoolContributionCents,
      denzilAwardCents: 0,
      denzilCapped: false,
      denzilCountAfter: denzilCountByEntry.get(seasonEntryId) ?? 0,
      weeklyWinShareCents: 0,
      // Item 8: Mary Rose is 9-0 and pays nothing.
      isMaryRose: wins === config.picksPerWeek && losses === 0 && pushes === 0,
    });
  }

  // Item 6: Denzil Awards, paid out of the weekly pool before the winner
  // split, capped per season, and only for a player who actually
  // submitted — a no-show's auto-loss is 0-9 by the numbers but earns
  // nothing (league rule 7).
  let denzilPaidCents = 0;
  for (const player of players) {
    const isZeroForNine =
      !player.noShow && player.wins === 0 && player.losses === config.picksPerWeek && player.pushes === 0;
    if (!isZeroForNine) continue;

    const countSoFar = denzilCountByEntry.get(player.seasonEntryId) ?? 0;
    if (countSoFar < config.denzilCapPerSeason) {
      player.denzilAwardCents = config.denzilAwardCents;
      player.denzilCountAfter = countSoFar + 1;
      denzilPaidCents += config.denzilAwardCents;
    } else {
      player.denzilCapped = true;
      player.denzilCountAfter = countSoFar;
    }
  }

  // Item 7: weekly winner is least dollars lost, not fewest losses.
  // Everyone tied at the minimum splits the post-Denzil remainder.
  const minGrossLossCents = players.reduce(
    (min, p) => (p.grossLossCents < min ? p.grossLossCents : min),
    Number.POSITIVE_INFINITY,
  );
  const winners = players.filter((p) => p.grossLossCents === minGrossLossCents);
  const remainderCents = weeklyPoolCents - denzilPaidCents;
  const weeklyWinShareCents = winners.length > 0 ? Math.floor(remainderCents / winners.length) : 0;
  // Item 5: pennies the split can't divide go to the season pool.
  const pennyRemainderToSeasonPoolCents = remainderCents - weeklyWinShareCents * winners.length;

  for (const winner of winners) {
    winner.weeklyWinShareCents = weeklyWinShareCents;
  }

  return {
    weekId,
    weekNumber,
    players,
    weeklyPoolCents,
    denzilPaidCents,
    weeklyWinnerEntryIds: winners.map((w) => w.seasonEntryId),
    weeklyWinnerGrossLossCents: winners.length > 0 ? minGrossLossCents : 0,
    weeklyWinShareCents,
    pennyRemainderToSeasonPoolCents,
  };
}
