import fs from "node:fs";
import path from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { FIXTURE_SEASON_LABEL } from "../src/db/fixture";
import { game, pick, season, seasonEntry, submission, week } from "../src/db/schema";

/**
 * Hand-computed answer key for the Phase D fixture season
 * (scripts/seed-fixture.ts), built from docs/denzil-product-spec-v2.md
 * section 3 only. Deliberately does NOT import src/lib/settlement or
 * anything it uses — every rule below (grading, rates, pools, awards,
 * standings, payouts) is reimplemented from the spec text, independent
 * of whatever the real engine ends up doing, so this can actually catch
 * a disagreement instead of just mirroring the same bug twice.
 *
 * Run: npm run fixture:expected — writes fixtures/expected.json and
 * prints weeks 4, 12, and 15 in full for an eye check.
 */

// ---------------------------------------------------------------------
// Config (spec section 2 — duplicated here on purpose, not imported)
// ---------------------------------------------------------------------
const BASE_LOSS_CENTS = 200;
const LEADER_LOSS_CENTS = 225;
const SPEED_LOSS_CENTS = 400;
const WEEKLY_POOL_PER_LOSS_CENTS = 175;
const LEADER_COUNT = 8;
const LEADER_WEEK_MIN = 12;
const LEADER_WEEK_MAX = 17;
const DENZIL_AWARD_CENTS = 7500;
const DENZIL_CAP_PER_SEASON = 3;
const ENTRY_FEE_CENTS = 3500;
const SEASON_PAYOUT_PCT = [36, 18, 15, 11, 8, 6, 4, 2];

const EYEBALL_WEEKS = [4, 12, 15];

// ---------------------------------------------------------------------
// Grading (spec section 3, "Settlement" items 2-3) — written fresh
// ---------------------------------------------------------------------
type PickRow = {
  market: "SPREAD" | "TOTAL";
  selection: "HOME" | "AWAY" | "OVER" | "UNDER";
  selectedTeamId: number | null;
  favoriteTeamId: number | null;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  spread: string | null;
  totalPoints: string | null;
};

type Grade = "WIN" | "LOSS" | "PUSH";

function gradeSpread(p: PickRow): Grade {
  const spread = Number(p.spread);
  const isFavorite = p.selectedTeamId === p.favoriteTeamId;
  const selectedScore = p.selectedTeamId === p.homeTeamId ? p.homeScore : p.awayScore;
  const oppScore = p.selectedTeamId === p.homeTeamId ? p.awayScore : p.homeScore;
  const margin = selectedScore - oppScore + (isFavorite ? -spread : spread);
  if (margin > 0) return "WIN";
  if (margin < 0) return "LOSS";
  return "PUSH";
}

function gradeTotal(p: PickRow): Grade {
  const combined = p.homeScore + p.awayScore;
  const total = Number(p.totalPoints);
  if (combined === total) return "PUSH";
  const overWins = combined > total;
  const pickedOver = p.selection === "OVER";
  return overWins === pickedOver ? "WIN" : "LOSS";
}

function gradePick(p: PickRow): Grade {
  return p.market === "SPREAD" ? gradeSpread(p) : gradeTotal(p);
}

// ---------------------------------------------------------------------
// Load fixture data
// ---------------------------------------------------------------------
async function loadFixture() {
  const [seasonRow] = await db.select().from(season).where(eq(season.label, FIXTURE_SEASON_LABEL)).limit(1);
  if (!seasonRow) {
    throw new Error(`fixture season "${FIXTURE_SEASON_LABEL}" not found — run npm run seed:fixture first`);
  }

  const weeks = await db.select().from(week).where(eq(week.seasonId, seasonRow.id)).orderBy(asc(week.number));
  const weekIds = weeks.map((w) => w.id);

  const entries = await db.select().from(seasonEntry).where(eq(seasonEntry.seasonId, seasonRow.id));

  const submissions = await db.select().from(submission).where(inArray(submission.weekId, weekIds));

  const pickRows = await db
    .select({
      seasonEntryId: pick.seasonEntryId,
      weekId: pick.weekId,
      selection: pick.selection,
      selectedTeamId: pick.selectedTeamId,
      market: game.market,
      spread: game.spread,
      totalPoints: game.totalPoints,
      favoriteTeamId: game.favoriteTeamId,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
    })
    .from(pick)
    .innerJoin(game, eq(pick.gameId, game.id))
    .where(inArray(pick.weekId, weekIds));

  return { seasonRow, weeks, entries, submissions, pickRows };
}

// ---------------------------------------------------------------------
// Settlement (spec section 3, "Settlement") — the real answer key
// ---------------------------------------------------------------------
type PlayerWeek = {
  entryId: number;
  name: string;
  noShow: boolean;
  wins: number;
  losses: number;
  pushes: number;
  isSpeedThisWeek: boolean;
  isHandicapThisWeek: boolean;
  rateCents: number;
  grossLossCents: number;
  weeklyPoolContributionCents: number;
  denzilAwardCents: number;
  denzilCapped: boolean;
  weeklyWinShareCents: number;
};

type WeekResult = {
  week: number;
  cumulativeEnteringWeek: Record<string, number>;
  leadingEight: string[] | null;
  weeklyPoolCents: number;
  denzilAwards: { name: string; amountCents: number; capped: boolean; seasonCountAfter: number }[];
  weeklyWinners: { name: string; grossLossCents: number; shareCents: number }[];
  weeklyRemainderToSeasonPoolCents: number;
  maryRoses: string[];
  players: Record<string, PlayerWeek>;
};

async function main() {
  const { seasonRow, weeks, entries, submissions, pickRows } = await loadFixture();

  const nameByEntry = new Map(entries.map((e) => [e.id, e.displayName]));
  const submissionByKey = new Map(submissions.map((s) => [`${s.seasonEntryId}-${s.weekId}`, s]));

  const picksByKey = new Map<string, PickRow[]>();
  for (const p of pickRows) {
    const key = `${p.seasonEntryId}-${p.weekId}`;
    const list = picksByKey.get(key) ?? [];
    list.push(p as PickRow);
    picksByKey.set(key, list);
  }

  const cumulative = new Map<number, number>(entries.map((e) => [e.id, 0]));
  const denzilCount = new Map<number, number>(entries.map((e) => [e.id, 0]));
  const seasonWeeklyWinnings = new Map<number, number>(entries.map((e) => [e.id, 0]));
  const seasonDenzilTotal = new Map<number, number>(entries.map((e) => [e.id, 0]));

  const weekResults: WeekResult[] = [];

  for (const w of weeks) {
    const cumulativeEnteringWeek: Record<string, number> = {};
    for (const e of entries) cumulativeEnteringWeek[nameByEntry.get(e.id)!] = cumulative.get(e.id)!;

    // Rate rule 1: leading eight by cumulative gross loss entering the
    // week, ties at 8th included, weeks 12-17 only.
    let leadingIds: Set<number> | null = null;
    if (w.number >= LEADER_WEEK_MIN && w.number <= LEADER_WEEK_MAX) {
      const sorted = [...entries].sort((a, b) => cumulative.get(a.id)! - cumulative.get(b.id)!);
      const cutoffValue = cumulative.get(sorted[Math.min(LEADER_COUNT - 1, sorted.length - 1)].id)!;
      leadingIds = new Set(entries.filter((e) => cumulative.get(e.id)! <= cutoffValue).map((e) => e.id));
    }

    const players: Record<string, PlayerWeek> = {};
    let weeklyPoolCents = 0;

    for (const e of entries) {
      const key = `${e.id}-${w.id}`;
      const sub = submissionByKey.get(key);
      const noShow = !sub;

      let wins = 0, losses = 0, pushes = 0;
      if (noShow) {
        // Rule 4: no submission -> 9 losses at that entry's rate.
        losses = 9;
      } else {
        for (const p of picksByKey.get(key) ?? []) {
          const g = gradePick(p);
          if (g === "WIN") wins++;
          else if (g === "LOSS") losses++;
          else pushes++;
        }
      }

      const isSpeedThisWeek = Boolean(sub?.isSpeedDeclared) || w.isSpeedWeekForAll;
      const isHandicapThisWeek = !isSpeedThisWeek && leadingIds !== null && leadingIds.has(e.id);
      const rateCents = isSpeedThisWeek ? SPEED_LOSS_CENTS : isHandicapThisWeek ? LEADER_LOSS_CENTS : BASE_LOSS_CENTS;
      const grossLossCents = losses * rateCents;
      const weeklyPoolContributionCents = losses * WEEKLY_POOL_PER_LOSS_CENTS;
      weeklyPoolCents += weeklyPoolContributionCents;

      players[nameByEntry.get(e.id)!] = {
        entryId: e.id,
        name: nameByEntry.get(e.id)!,
        noShow,
        wins,
        losses,
        pushes,
        isSpeedThisWeek,
        isHandicapThisWeek,
        rateCents,
        grossLossCents,
        weeklyPoolContributionCents,
        denzilAwardCents: 0,
        denzilCapped: false,
        weeklyWinShareCents: 0,
      };
    }

    // Rule 6: Denzil Awards — 0-9, $75 from the weekly pool, capped
    // 3/season, paid before the winner split. Processed in season
    // (week-ascending) order, which this outer loop already guarantees.
    // A no-show is 0-9 by the numbers (rule 4) but earns no award —
    // league rule 7 requires a submission.
    const denzilAwards: WeekResult["denzilAwards"] = [];
    let totalDenzilPaidCents = 0;
    for (const e of entries) {
      const pw = players[nameByEntry.get(e.id)!];
      if (!pw.noShow && pw.wins === 0 && pw.losses === 9 && pw.pushes === 0) {
        const countSoFar = denzilCount.get(e.id)!;
        const awarded = countSoFar < DENZIL_CAP_PER_SEASON;
        const amountCents = awarded ? DENZIL_AWARD_CENTS : 0;
        pw.denzilAwardCents = amountCents;
        pw.denzilCapped = !awarded;
        if (awarded) denzilCount.set(e.id, countSoFar + 1);
        totalDenzilPaidCents += amountCents;
        seasonDenzilTotal.set(e.id, seasonDenzilTotal.get(e.id)! + amountCents);
        denzilAwards.push({
          name: pw.name,
          amountCents,
          capped: !awarded,
          seasonCountAfter: awarded ? countSoFar + 1 : countSoFar,
        });
      }
    }

    // Rule 7: Weekly Winner(s) — least dollars lost, ties split the
    // post-Denzil remainder equally.
    const minGrossLossCents = Math.min(...entries.map((e) => players[nameByEntry.get(e.id)!].grossLossCents));
    const winnerEntries = entries.filter((e) => players[nameByEntry.get(e.id)!].grossLossCents === minGrossLossCents);
    const remainderAfterDenzilCents = weeklyPoolCents - totalDenzilPaidCents;
    const shareCents = Math.floor(remainderAfterDenzilCents / winnerEntries.length);
    const leftoverCents = remainderAfterDenzilCents - shareCents * winnerEntries.length;

    const weeklyWinners: WeekResult["weeklyWinners"] = [];
    for (const e of winnerEntries) {
      const pw = players[nameByEntry.get(e.id)!];
      pw.weeklyWinShareCents = shareCents;
      seasonWeeklyWinnings.set(e.id, seasonWeeklyWinnings.get(e.id)! + shareCents);
      weeklyWinners.push({ name: pw.name, grossLossCents: minGrossLossCents, shareCents });
    }

    // Rule 8: Mary Rose — 9-0, $0. A named milestone, no dollars move.
    const maryRoses = entries
      .map((e) => players[nameByEntry.get(e.id)!])
      .filter((pw) => pw.wins === 9 && pw.losses === 0 && pw.pushes === 0)
      .map((pw) => pw.name);

    for (const e of entries) {
      cumulative.set(e.id, cumulative.get(e.id)! + players[nameByEntry.get(e.id)!].grossLossCents);
    }

    weekResults.push({
      week: w.number,
      cumulativeEnteringWeek,
      leadingEight: leadingIds ? [...leadingIds].map((id) => nameByEntry.get(id)!).sort() : null,
      weeklyPoolCents,
      denzilAwards,
      weeklyWinners,
      weeklyRemainderToSeasonPoolCents: leftoverCents,
      maryRoses,
      players,
    });
  }

  // -------------------------------------------------------------------
  // Season pool + standings (spec section 3, formulas after the list)
  // -------------------------------------------------------------------
  const seasonPoolFromEntryFeesCents = entries.length * ENTRY_FEE_CENTS;
  let seasonPoolFromLossRemaindersCents = 0;
  let seasonPoolFromWeeklyPenniesCents = 0;
  for (const wr of weekResults) {
    seasonPoolFromWeeklyPenniesCents += wr.weeklyRemainderToSeasonPoolCents;
    for (const name in wr.players) {
      const pw = wr.players[name];
      seasonPoolFromLossRemaindersCents += pw.grossLossCents - pw.weeklyPoolContributionCents;
    }
  }
  const seasonPoolCents =
    seasonPoolFromEntryFeesCents + seasonPoolFromLossRemaindersCents + seasonPoolFromWeeklyPenniesCents;

  const finalSorted = [...entries].sort((a, b) => cumulative.get(a.id)! - cumulative.get(b.id)!);

  // Standings ties: tied players occupy consecutive rank slots, sum the
  // payout percentage of every slot they occupy, and split it evenly.
  // Two tied for 3rd occupy ranks 3 and 4 -> 15% + 11% = 26%, 13% each,
  // and the next player is rank 5. A tie straddling the cutoff sums a
  // paying slot with a non-paying one (ranks 8 and 9 -> 2% + 0%).
  type Allocation = {
    entryId: number;
    rank: number;
    occupiesRanks: number[];
    tiedCount: number;
    payoutPctTotal: number;
    remainderNumerator: number;
    denominator: number;
    payoutCents: number;
    roundingCentAdded: boolean;
  };

  const allocations: Allocation[] = [];
  let cursor = 0;
  while (cursor < finalSorted.length) {
    const value = cumulative.get(finalSorted[cursor].id)!;
    let end = cursor;
    while (end < finalSorted.length && cumulative.get(finalSorted[end].id)! === value) end++;

    const members = finalSorted.slice(cursor, end);
    const occupiesRanks = members.map((_, k) => cursor + 1 + k);
    const payoutPctTotal = occupiesRanks.reduce(
      (sum, r) => sum + (r <= SEASON_PAYOUT_PCT.length ? SEASON_PAYOUT_PCT[r - 1] : 0),
      0,
    );

    // Exact share is (pool x pct) / (100 x groupSize). Keep it as an
    // integer numerator so the fractional part is exact, not a float.
    const denominator = 100 * members.length;
    const numerator = seasonPoolCents * payoutPctTotal;
    const floorCents = Math.floor(numerator / denominator);
    const remainderNumerator = numerator - floorCents * denominator;

    for (const m of members) {
      allocations.push({
        entryId: m.id,
        rank: cursor + 1,
        occupiesRanks,
        tiedCount: members.length,
        payoutPctTotal,
        remainderNumerator,
        denominator,
        payoutCents: floorCents,
        roundingCentAdded: false,
      });
    }
    cursor = end;
  }

  // The eight percentages sum to 100, so the exact shares sum to the
  // pool exactly — only integer-cent truncation leaves a residue. Hand
  // those pennies to the largest fractional remainders, best rank
  // first, so every cent of the pool lands on a player.
  const floorTotalCents = allocations.reduce((s, a) => s + a.payoutCents, 0);
  let residualCents = seasonPoolCents - floorTotalCents;
  const pennyOrder = allocations
    .filter((a) => a.payoutPctTotal > 0)
    .sort((a, b) => {
      const fractionDelta = b.remainderNumerator / b.denominator - a.remainderNumerator / a.denominator;
      if (fractionDelta !== 0) return fractionDelta;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.entryId - b.entryId;
    });
  for (const a of pennyOrder) {
    if (residualCents <= 0) break;
    a.payoutCents += 1;
    a.roundingCentAdded = true;
    residualCents--;
  }

  const allocationByEntry = new Map(allocations.map((a) => [a.entryId, a]));
  let payoutAllocatedCents = 0;
  const standings = finalSorted.map((e) => {
    const a = allocationByEntry.get(e.id)!;
    const cumulativeGrossLossCents = cumulative.get(e.id)!;
    payoutAllocatedCents += a.payoutCents;
    const totalWeeklyWinningsCents = seasonWeeklyWinnings.get(e.id)!;
    const totalDenzilAwardCents = seasonDenzilTotal.get(e.id)!;
    const netSettleCents =
      totalWeeklyWinningsCents + totalDenzilAwardCents + a.payoutCents - cumulativeGrossLossCents - ENTRY_FEE_CENTS;
    return {
      rank: a.rank,
      name: nameByEntry.get(e.id)!,
      cumulativeGrossLossCents,
      tiedCount: a.tiedCount,
      occupiesRanks: a.occupiesRanks,
      payoutPctTotal: a.payoutPctTotal,
      payoutPctEach: a.payoutPctTotal / a.tiedCount,
      totalWeeklyWinningsCents,
      totalDenzilAwardCents,
      seasonPayoutCents: a.payoutCents,
      payoutRoundingCentAdded: a.roundingCentAdded,
      netSettleCents,
    };
  });

  if (payoutAllocatedCents !== seasonPoolCents) {
    console.warn(
      `season pool allocation mismatch: allocated ${payoutAllocatedCents} of ${seasonPoolCents} cents — the payout split has a leak.`,
    );
  }

  const output = {
    meta: {
      generatedFrom: "docs/denzil-product-spec-v2.md section 3 (hand-duplicated, no shared code with the engine)",
      seasonId: seasonRow.id,
      seasonLabel: seasonRow.label,
      playerCount: entries.length,
      weekCount: weeks.length,
    },
    weeks: weekResults,
    seasonPool: {
      fromEntryFeesCents: seasonPoolFromEntryFeesCents,
      fromLossRemaindersCents: seasonPoolFromLossRemaindersCents,
      fromWeeklyPenniesCents: seasonPoolFromWeeklyPenniesCents,
      totalCents: seasonPoolCents,
      payoutAllocatedCents,
      payoutUnallocatedCents: seasonPoolCents - payoutAllocatedCents,
    },
    standings,
  };

  const outPath = path.join(__dirname, "..", "fixtures", "expected.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`wrote ${outPath}`);

  for (const wn of EYEBALL_WEEKS) {
    printWeekDetail(weekResults.find((wr) => wr.week === wn)!);
  }

  console.log("\n=== Final season standings ===");
  console.table(
    standings.map((s) => ({
      rank: s.tiedCount > 1 ? `${s.rank} (T${s.tiedCount})` : `${s.rank}`,
      name: s.name,
      cumulativeLoss: `$${(s.cumulativeGrossLossCents / 100).toFixed(2)}`,
      payoutPct: s.payoutPctTotal > 0 ? `${s.payoutPctEach}%` : "",
      weeklyWinnings: `$${(s.totalWeeklyWinningsCents / 100).toFixed(2)}`,
      denzilTotal: `$${(s.totalDenzilAwardCents / 100).toFixed(2)}`,
      seasonPayout: `$${(s.seasonPayoutCents / 100).toFixed(2)}${s.payoutRoundingCentAdded ? " +1c" : ""}`,
      netSettle: `$${(s.netSettleCents / 100).toFixed(2)}`,
    })),
  );

  console.log("\n=== Season pool ===");
  console.log(`  entry fees:             $${(seasonPoolFromEntryFeesCents / 100).toFixed(2)}`);
  console.log(`  loss remainders:        $${(seasonPoolFromLossRemaindersCents / 100).toFixed(2)}`);
  console.log(`  weekly pool pennies:    $${(seasonPoolFromWeeklyPenniesCents / 100).toFixed(2)}`);
  console.log(`  total:                  $${(seasonPoolCents / 100).toFixed(2)}`);
  console.log(`  allocated to payouts:   $${(payoutAllocatedCents / 100).toFixed(2)}`);
  console.log(`  left unallocated:       $${((seasonPoolCents - payoutAllocatedCents) / 100).toFixed(2)}`);
}

function printWeekDetail(wr: WeekResult) {
  console.log(`\n=== Week ${wr.week} ===`);
  if (wr.leadingEight) {
    console.log(`Leading (handicap-eligible) this week: ${wr.leadingEight.join(", ")}`);
  }
  console.log(`Weekly pool: $${(wr.weeklyPoolCents / 100).toFixed(2)}`);
  if (wr.denzilAwards.length > 0) {
    for (const d of wr.denzilAwards) {
      console.log(
        `  Denzil: ${d.name} -> $${(d.amountCents / 100).toFixed(2)}${d.capped ? " (CAPPED — 4th+ 0-9 this season, no award)" : ""} [season count after: ${d.seasonCountAfter}]`,
      );
    }
  }
  for (const wnr of wr.weeklyWinners) {
    console.log(`  Weekly winner: ${wnr.name} (lost $${(wnr.grossLossCents / 100).toFixed(2)}) -> share $${(wnr.shareCents / 100).toFixed(2)}`);
  }
  if (wr.maryRoses.length > 0) {
    console.log(`  Mary Rose (9-0): ${wr.maryRoses.join(", ")}`);
  }
  console.table(
    Object.values(wr.players)
      .sort((a, b) => a.grossLossCents - b.grossLossCents)
      .map((p) => ({
        name: p.name,
        record: p.noShow ? "NO SHOW" : `${p.wins}-${p.losses}${p.pushes ? `-${p.pushes}` : ""}`,
        rate: p.isSpeedThisWeek ? "speed $4.00" : p.isHandicapThisWeek ? "handicap $2.25" : "base $2.00",
        grossLoss: `$${(p.grossLossCents / 100).toFixed(2)}`,
        denzil: p.denzilAwardCents ? `$${(p.denzilAwardCents / 100).toFixed(2)}${p.denzilCapped ? " (capped)" : ""}` : "",
        weeklyWinShare: p.weeklyWinShareCents ? `$${(p.weeklyWinShareCents / 100).toFixed(2)}` : "",
      })),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
