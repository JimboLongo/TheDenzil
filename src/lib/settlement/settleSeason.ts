import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { game, pick, season, seasonEntry, submission, week, weekResult } from "@/db/schema";
import { parseSettlementConfig, type SettlementConfig } from "./config";
import type { SettlementGame, SettlementPick } from "./grade";
import { assignRate, leadingGroup, type Rate } from "./rates";
import { settleWeek, type WeekSettlement } from "./settleWeek";

/**
 * The settlement engine — Phase D.
 *
 * "Scoring is a pure function, replayed in week order. Dollars are never
 * stored as source of truth." (spec section 1.) So this reads only
 * picks, games, submissions and config; it never reads a stored dollar
 * figure, not even one it wrote itself on a previous run. week_result is
 * a derived cache: it is deleted and rebuilt wholesale every run.
 */
export type SeasonStanding = {
  seasonEntryId: number;
  displayName: string;
  /** Null for an entry excluded from the Season Pool (league rule 1). */
  seasonPoolEligible: boolean;
  rank: number | null;
  occupiesRanks: number[];
  tiedCount: number;
  cumulativeGrossLossCents: number;
  payoutPctTotal: number;
  payoutPctEach: number;
  seasonPayoutCents: number;
  payoutRoundingCentAdded: boolean;
  totalWeeklyWinningsCents: number;
  totalDenzilAwardCents: number;
  netSettleCents: number;
};

export type SeasonSettlement = {
  seasonId: number;
  weeks: {
    settlement: WeekSettlement;
    cumulativeEnteringWeek: Map<number, number>;
    leadingGroupEntryIds: number[] | null;
    rankAfterWeekByEntry: Map<number, number>;
  }[];
  seasonPool: {
    fromEntryFeesCents: number;
    fromLossRemaindersCents: number;
    fromWeeklyPenniesCents: number;
    totalCents: number;
    payoutAllocatedCents: number;
  };
  standings: SeasonStanding[];
  config: SettlementConfig;
};

/**
 * Competition ranking: tied players share the first rank of the block
 * they occupy, and the next player takes the rank after the last slot
 * the block used. Two tied for 3rd occupy ranks 3 and 4; the next is 5.
 */
function tieGroups<T>(sortedAsc: T[], valueOf: (item: T) => number): { members: T[]; startRank: number }[] {
  const groups: { members: T[]; startRank: number }[] = [];
  let cursor = 0;
  while (cursor < sortedAsc.length) {
    const value = valueOf(sortedAsc[cursor]);
    let end = cursor;
    while (end < sortedAsc.length && valueOf(sortedAsc[end]) === value) end++;
    groups.push({ members: sortedAsc.slice(cursor, end), startRank: cursor + 1 });
    cursor = end;
  }
  return groups;
}

function rankByCumulative(cumulativeByEntry: Map<number, number>): Map<number, number> {
  const sorted = [...cumulativeByEntry.entries()].sort((a, b) => a[1] - b[1]);
  const ranks = new Map<number, number>();
  for (const group of tieGroups(sorted, ([, value]) => value)) {
    for (const [entryId] of group.members) ranks.set(entryId, group.startRank);
  }
  return ranks;
}

/**
 * `markWeeksFinal` defaults to true: settlement is the only thing
 * allowed to move a week from 'settling' to 'final'. Pass false to
 * settle without committing that transition — the fixture diff does,
 * so the fixture season stays re-runnable.
 */
export async function settleSeason(
  seasonId: number,
  options: { markWeeksFinal?: boolean } = {},
): Promise<SeasonSettlement> {
  const markWeeksFinal = options.markWeeksFinal ?? true;
  const [seasonRow] = await db.select().from(season).where(eq(season.id, seasonId)).limit(1);
  if (!seasonRow) throw new Error(`season ${seasonId} not found`);
  const config = parseSettlementConfig(seasonRow.config);

  const weeks = await db.select().from(week).where(eq(week.seasonId, seasonId)).orderBy(asc(week.number));
  if (weeks.length === 0) throw new Error(`season ${seasonId} has no weeks`);
  const weekIds = weeks.map((w) => w.id);

  const entries = await db.select().from(seasonEntry).where(eq(seasonEntry.seasonId, seasonId));
  if (entries.length === 0) throw new Error(`season ${seasonId} has no entries`);
  // Every entry settles weekly — losing money, feeding the weekly pool,
  // taking Denzils, winning weekly pools. Season Pool eligibility (league
  // rule 1) only decides who can be paid *from* the season pool; the
  // ineligible still pay into it.
  const seasonEntryIds = entries.map((e) => e.id);
  const eligibleEntryIds = entries.filter((e) => e.seasonPoolEligible).map((e) => e.id);
  const eligibleSet = new Set(eligibleEntryIds);
  const displayNameByEntry = new Map(entries.map((e) => [e.id, e.displayName]));

  if (eligibleEntryIds.length > 0 && eligibleEntryIds.length < config.seasonPayoutPct.length) {
    throw new Error(
      `season ${seasonId} has ${eligibleEntryIds.length} Season Pool-eligible entries but the payout table ` +
        `has ${config.seasonPayoutPct.length} places. Distributing a ${config.seasonPayoutPct.reduce((a, b) => a + b, 0)}% ` +
        `table across fewer places is not a rule the spec settles — it needs a commissioner ruling.`,
    );
  }

  const submissions = await db.select().from(submission).where(inArray(submission.weekId, weekIds));
  const games = await db.select().from(game).where(inArray(game.weekId, weekIds));
  const picks = await db.select().from(pick).where(inArray(pick.weekId, weekIds));

  const submissionsByWeek = new Map<number, Map<number, { isSpeedDeclared: boolean }>>();
  for (const s of submissions) {
    const byEntry = submissionsByWeek.get(s.weekId) ?? new Map();
    byEntry.set(s.seasonEntryId, { isSpeedDeclared: s.isSpeedDeclared });
    submissionsByWeek.set(s.weekId, byEntry);
  }

  const gamesByWeek = new Map<number, Map<number, SettlementGame>>();
  for (const g of games) {
    const byId = gamesByWeek.get(g.weekId) ?? new Map();
    byId.set(g.id, g as SettlementGame);
    gamesByWeek.set(g.weekId, byId);
  }

  const picksByWeek = new Map<number, Map<number, SettlementPick[]>>();
  for (const p of picks) {
    const byEntry = picksByWeek.get(p.weekId) ?? new Map<number, SettlementPick[]>();
    const list = byEntry.get(p.seasonEntryId) ?? [];
    list.push({ gameId: p.gameId, selection: p.selection });
    byEntry.set(p.seasonEntryId, list);
    picksByWeek.set(p.weekId, byEntry);
  }

  const cumulative = new Map<number, number>(seasonEntryIds.map((id) => [id, 0]));
  const denzilCount = new Map<number, number>(seasonEntryIds.map((id) => [id, 0]));
  const weeklyWinningsTotal = new Map<number, number>(seasonEntryIds.map((id) => [id, 0]));
  const denzilTotal = new Map<number, number>(seasonEntryIds.map((id) => [id, 0]));

  const settledWeeks: SeasonSettlement["weeks"] = [];
  let fromLossRemaindersCents = 0;
  let fromWeeklyPenniesCents = 0;

  for (const w of weeks) {
    const cumulativeEnteringWeek = new Map(cumulative);

    const [firstLeaderWeek, lastLeaderWeek] = config.leaderWeekRange;
    const inLeaderWindow = w.number >= firstLeaderWeek && w.number <= lastLeaderWeek;
    const leaders = inLeaderWindow ? leadingGroup(cumulativeEnteringWeek, config.leaderCount) : null;

    const submissionByEntry = submissionsByWeek.get(w.id) ?? new Map();
    const rateByEntry = new Map<number, Rate>();
    for (const entryId of seasonEntryIds) {
      rateByEntry.set(
        entryId,
        assignRate({
          weekNumber: w.number,
          isSpeedWeekForAll: w.isSpeedWeekForAll,
          isSpeedDeclared: submissionByEntry.get(entryId)?.isSpeedDeclared ?? false,
          inLeadingGroup: leaders?.has(entryId) ?? false,
          config,
        }),
      );
    }

    const settlement = settleWeek({
      weekId: w.id,
      weekNumber: w.number,
      seasonEntryIds,
      submissionByEntry,
      picksByEntry: picksByWeek.get(w.id) ?? new Map(),
      gamesById: gamesByWeek.get(w.id) ?? new Map(),
      rateByEntry,
      denzilCountByEntry: denzilCount,
      config,
    });

    for (const player of settlement.players) {
      cumulative.set(player.seasonEntryId, cumulative.get(player.seasonEntryId)! + player.grossLossCents);
      denzilCount.set(player.seasonEntryId, player.denzilCountAfter);
      weeklyWinningsTotal.set(
        player.seasonEntryId,
        weeklyWinningsTotal.get(player.seasonEntryId)! + player.weeklyWinShareCents,
      );
      denzilTotal.set(player.seasonEntryId, denzilTotal.get(player.seasonEntryId)! + player.denzilAwardCents);
      fromLossRemaindersCents += player.grossLossCents - player.weeklyPoolContributionCents;
    }
    fromWeeklyPenniesCents += settlement.pennyRemainderToSeasonPoolCents;

    settledWeeks.push({
      settlement,
      cumulativeEnteringWeek,
      leadingGroupEntryIds: leaders ? [...leaders] : null,
      // Ranked over eligible entries only, to stay consistent with the
      // season standings they're a running snapshot of. An ineligible
      // entry gets a null rankAfterWeek.
      rankAfterWeekByEntry: rankByCumulative(
        new Map([...cumulative].filter(([entryId]) => eligibleSet.has(entryId))),
      ),
    });
  }

  const fromEntryFeesCents = entries.length * config.entryFeeCents;
  const totalCents = fromEntryFeesCents + fromLossRemaindersCents + fromWeeklyPenniesCents;

  // Standings ties: the block sums the payout percentage of every slot
  // it occupies and splits it evenly. Percentages sum to 100, so the
  // exact shares sum to the pool; only integer-cent truncation leaves a
  // residue, which goes to the largest fractional remainders, best rank
  // first, until every cent is placed.
  // Ranked across eligible entries only — an ineligible entry holds no
  // rank and so never displaces anyone below it.
  const sortedEntries = [...eligibleEntryIds].sort((a, b) => cumulative.get(a)! - cumulative.get(b)!);
  // Drafts only ever hold eligible entries, which always carry a rank.
  type Draft = Omit<SeasonStanding, "rank"> & {
    rank: number;
    remainderNumerator: number;
    denominator: number;
  };
  const drafts: Draft[] = [];

  for (const group of tieGroups(sortedEntries, (entryId) => cumulative.get(entryId)!)) {
    const occupiesRanks = group.members.map((_, index) => group.startRank + index);
    const payoutPctTotal = occupiesRanks.reduce(
      (sum, rank) => sum + (rank <= config.seasonPayoutPct.length ? config.seasonPayoutPct[rank - 1] : 0),
      0,
    );
    const denominator = 100 * group.members.length;
    const numerator = totalCents * payoutPctTotal;
    const floorCents = Math.floor(numerator / denominator);
    const remainderNumerator = numerator - floorCents * denominator;

    for (const entryId of group.members) {
      drafts.push({
        seasonEntryId: entryId,
        displayName: displayNameByEntry.get(entryId)!,
        seasonPoolEligible: true,
        rank: group.startRank,
        occupiesRanks,
        tiedCount: group.members.length,
        cumulativeGrossLossCents: cumulative.get(entryId)!,
        payoutPctTotal,
        payoutPctEach: payoutPctTotal / group.members.length,
        seasonPayoutCents: floorCents,
        payoutRoundingCentAdded: false,
        totalWeeklyWinningsCents: weeklyWinningsTotal.get(entryId)!,
        totalDenzilAwardCents: denzilTotal.get(entryId)!,
        netSettleCents: 0,
        remainderNumerator,
        denominator,
      });
    }
  }

  let residualCents = totalCents - drafts.reduce((sum, d) => sum + d.seasonPayoutCents, 0);
  const pennyOrder = drafts
    .filter((d) => d.payoutPctTotal > 0)
    .sort((a, b) => {
      const byFraction = b.remainderNumerator / b.denominator - a.remainderNumerator / a.denominator;
      if (byFraction !== 0) return byFraction;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.seasonEntryId - b.seasonEntryId;
    });
  for (const draft of pennyOrder) {
    if (residualCents <= 0) break;
    draft.seasonPayoutCents += 1;
    draft.payoutRoundingCentAdded = true;
    residualCents -= 1;
  }

  const standings: SeasonStanding[] = drafts.map((draft) => ({
    seasonEntryId: draft.seasonEntryId,
    displayName: draft.displayName,
    seasonPoolEligible: true,
    rank: draft.rank,
    occupiesRanks: draft.occupiesRanks,
    tiedCount: draft.tiedCount,
    cumulativeGrossLossCents: draft.cumulativeGrossLossCents,
    payoutPctTotal: draft.payoutPctTotal,
    payoutPctEach: draft.payoutPctEach,
    seasonPayoutCents: draft.seasonPayoutCents,
    payoutRoundingCentAdded: draft.payoutRoundingCentAdded,
    totalWeeklyWinningsCents: draft.totalWeeklyWinningsCents,
    totalDenzilAwardCents: draft.totalDenzilAwardCents,
    netSettleCents:
      draft.totalWeeklyWinningsCents +
      draft.totalDenzilAwardCents +
      draft.seasonPayoutCents -
      draft.cumulativeGrossLossCents -
      config.entryFeeCents,
  }));

  // Ineligible entries still get a row so their weekly winnings, awards
  // and net settle are reportable — they just hold no rank and take no
  // payout. They sort after everyone ranked.
  for (const entryId of seasonEntryIds) {
    if (eligibleSet.has(entryId)) continue;
    standings.push({
      seasonEntryId: entryId,
      displayName: displayNameByEntry.get(entryId)!,
      seasonPoolEligible: false,
      rank: null,
      occupiesRanks: [],
      tiedCount: 0,
      cumulativeGrossLossCents: cumulative.get(entryId)!,
      payoutPctTotal: 0,
      payoutPctEach: 0,
      seasonPayoutCents: 0,
      payoutRoundingCentAdded: false,
      totalWeeklyWinningsCents: weeklyWinningsTotal.get(entryId)!,
      totalDenzilAwardCents: denzilTotal.get(entryId)!,
      netSettleCents:
        weeklyWinningsTotal.get(entryId)! +
        denzilTotal.get(entryId)! -
        cumulative.get(entryId)! -
        config.entryFeeCents,
    });
  }

  const payoutAllocatedCents = standings.reduce((sum, s) => sum + s.seasonPayoutCents, 0);
  if (payoutAllocatedCents !== totalCents) {
    throw new Error(
      `season pool allocation leak: allocated ${payoutAllocatedCents} of ${totalCents} cents`,
    );
  }

  // week_result is a rebuildable cache — truncate this season's rows and
  // write them fresh, so a re-run can never blend old and new dollars.
  const rows = settledWeeks.flatMap((sw) =>
    sw.settlement.players.map((p) => ({
      seasonEntryId: p.seasonEntryId,
      weekId: sw.settlement.weekId,
      wins: p.wins,
      losses: p.losses,
      pushes: p.pushes,
      rateAppliedCents: p.rateAppliedCents,
      grossLossCents: p.grossLossCents,
      weeklyWinShareCents: p.weeklyWinShareCents,
      denzilAwardCents: p.denzilAwardCents,
      rankAfterWeek: sw.rankAfterWeekByEntry.get(p.seasonEntryId) ?? null,
    })),
  );

  await db.transaction(async (tx) => {
    await tx.delete(weekResult).where(inArray(weekResult.weekId, weekIds));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(weekResult).values(rows.slice(i, i + 500));
    }
    if (markWeeksFinal) {
      await tx.update(week).set({ status: "final" }).where(inArray(week.id, weekIds));
    }
  });

  return {
    seasonId,
    weeks: settledWeeks,
    seasonPool: {
      fromEntryFeesCents,
      fromLossRemaindersCents,
      fromWeeklyPenniesCents,
      totalCents,
      payoutAllocatedCents,
    },
    standings,
    config,
  };
}
