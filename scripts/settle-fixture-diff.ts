import fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { FIXTURE_SEASON_LABEL } from "../src/db/fixture";
import { season, seasonEntry, week, weekResult } from "../src/db/schema";
import { settleSeason } from "../src/lib/settlement/settleSeason";

/**
 * Runs the settlement engine against the fixture season and diffs every
 * value against fixtures/expected.json, the independently hand-computed
 * answer key. Reports disagreements and changes nothing on either side.
 */
type Disagreement = {
  player: string;
  week: string;
  field: string;
  expected: unknown;
  actual: unknown;
};

const disagreements: Disagreement[] = [];
let comparisons = 0;

function check(player: string, week: string, field: string, expected: unknown, actual: unknown) {
  comparisons++;
  const same = Array.isArray(expected) || typeof expected === "object"
    ? JSON.stringify(expected) === JSON.stringify(actual)
    : expected === actual;
  if (!same) disagreements.push({ player, week, field, expected, actual });
}

async function main() {
  const [seasonRow] = await db.select().from(season).where(eq(season.label, FIXTURE_SEASON_LABEL)).limit(1);
  if (!seasonRow) throw new Error(`fixture season not found — run npm run seed:fixture`);

  const expectedPath = path.join(__dirname, "..", "fixtures", "expected.json");
  if (!fs.existsSync(expectedPath)) throw new Error(`${expectedPath} missing — run npm run fixture:expected`);
  const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));

  if (expected.meta.seasonId !== seasonRow.id) {
    console.warn(
      `note: expected.json was generated against season ${expected.meta.seasonId}, now settling season ${seasonRow.id}`,
    );
  }

  const entries = await db.select().from(seasonEntry).where(eq(seasonEntry.seasonId, seasonRow.id));
  const nameByEntry = new Map(entries.map((e) => [e.id, e.displayName]));

  console.log(`settling season ${seasonRow.id} (${entries.length} entries)...`);
  // markWeeksFinal: false keeps the fixture weeks in 'settling' so this
  // diff stays re-runnable without reseeding.
  const result = await settleSeason(seasonRow.id, { markWeeksFinal: false });

  // ---- per week ----
  if (expected.weeks.length !== result.weeks.length) {
    check("-", "-", "week count", expected.weeks.length, result.weeks.length);
  }

  for (const expectedWeek of expected.weeks) {
    const actualWeek = result.weeks.find((w) => w.settlement.weekNumber === expectedWeek.week);
    if (!actualWeek) {
      check("-", `W${expectedWeek.week}`, "week present", true, false);
      continue;
    }
    const wk = `W${expectedWeek.week}`;
    const s = actualWeek.settlement;

    check("-", wk, "weeklyPoolCents", expectedWeek.weeklyPoolCents, s.weeklyPoolCents);
    check(
      "-",
      wk,
      "weeklyRemainderToSeasonPoolCents",
      expectedWeek.weeklyRemainderToSeasonPoolCents,
      s.pennyRemainderToSeasonPoolCents,
    );

    const actualLeading = actualWeek.leadingGroupEntryIds
      ? actualWeek.leadingGroupEntryIds.map((id) => nameByEntry.get(id)!).sort()
      : null;
    check("-", wk, "leadingEight", expectedWeek.leadingEight, actualLeading);

    const actualDenzil = s.players
      .filter((p) => p.denzilAwardCents > 0 || p.denzilCapped)
      .map((p) => ({
        name: nameByEntry.get(p.seasonEntryId)!,
        amountCents: p.denzilAwardCents,
        capped: p.denzilCapped,
        seasonCountAfter: p.denzilCountAfter,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    check("-", wk, "denzilAwards", [...expectedWeek.denzilAwards].sort((a: {name:string}, b: {name:string}) => a.name.localeCompare(b.name)), actualDenzil);

    const actualWinners = s.weeklyWinnerEntryIds
      .map((id) => ({
        name: nameByEntry.get(id)!,
        grossLossCents: s.weeklyWinnerGrossLossCents,
        shareCents: s.weeklyWinShareCents,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    check("-", wk, "weeklyWinners", [...expectedWeek.weeklyWinners].sort((a: {name:string}, b: {name:string}) => a.name.localeCompare(b.name)), actualWinners);

    const actualMaryRoses = s.players
      .filter((p) => p.isMaryRose)
      .map((p) => nameByEntry.get(p.seasonEntryId)!)
      .sort();
    check("-", wk, "maryRoses", [...expectedWeek.maryRoses].sort(), actualMaryRoses);

    for (const [name, expectedPlayer] of Object.entries<Record<string, unknown>>(expectedWeek.players)) {
      const entryId = [...nameByEntry.entries()].find(([, n]) => n === name)?.[0];
      const actualPlayer = s.players.find((p) => p.seasonEntryId === entryId);
      if (!actualPlayer) {
        check(name, wk, "player present", true, false);
        continue;
      }

      check(name, wk, "wins", expectedPlayer.wins, actualPlayer.wins);
      check(name, wk, "losses", expectedPlayer.losses, actualPlayer.losses);
      check(name, wk, "pushes", expectedPlayer.pushes, actualPlayer.pushes);
      check(name, wk, "noShow", expectedPlayer.noShow, actualPlayer.noShow);
      check(name, wk, "rateCents", expectedPlayer.rateCents, actualPlayer.rateAppliedCents);
      check(name, wk, "isSpeedThisWeek", expectedPlayer.isSpeedThisWeek, actualPlayer.rateKind === "speed");
      check(
        name,
        wk,
        "isHandicapThisWeek",
        expectedPlayer.isHandicapThisWeek,
        actualPlayer.rateKind === "handicap",
      );
      check(name, wk, "grossLossCents", expectedPlayer.grossLossCents, actualPlayer.grossLossCents);
      check(
        name,
        wk,
        "weeklyPoolContributionCents",
        expectedPlayer.weeklyPoolContributionCents,
        actualPlayer.weeklyPoolContributionCents,
      );
      check(name, wk, "denzilAwardCents", expectedPlayer.denzilAwardCents, actualPlayer.denzilAwardCents);
      check(name, wk, "denzilCapped", expectedPlayer.denzilCapped, actualPlayer.denzilCapped);
      check(
        name,
        wk,
        "weeklyWinShareCents",
        expectedPlayer.weeklyWinShareCents,
        actualPlayer.weeklyWinShareCents,
      );
      check(
        name,
        wk,
        "cumulativeEnteringWeek",
        expectedWeek.cumulativeEnteringWeek[name],
        actualWeek.cumulativeEnteringWeek.get(entryId!),
      );
    }
  }

  // ---- season pool ----
  const pool = expected.seasonPool;
  check("-", "season", "pool.fromEntryFeesCents", pool.fromEntryFeesCents, result.seasonPool.fromEntryFeesCents);
  check(
    "-",
    "season",
    "pool.fromLossRemaindersCents",
    pool.fromLossRemaindersCents,
    result.seasonPool.fromLossRemaindersCents,
  );
  check(
    "-",
    "season",
    "pool.fromWeeklyPenniesCents",
    pool.fromWeeklyPenniesCents,
    result.seasonPool.fromWeeklyPenniesCents,
  );
  check("-", "season", "pool.totalCents", pool.totalCents, result.seasonPool.totalCents);
  check(
    "-",
    "season",
    "pool.payoutAllocatedCents",
    pool.payoutAllocatedCents,
    result.seasonPool.payoutAllocatedCents,
  );
  check(
    "-",
    "season",
    "pool.payoutUnallocatedCents",
    pool.payoutUnallocatedCents,
    result.seasonPool.totalCents - result.seasonPool.payoutAllocatedCents,
  );

  // ---- standings ----
  for (const expectedStanding of expected.standings) {
    const name = expectedStanding.name;
    const actual = result.standings.find((s) => s.displayName === name);
    if (!actual) {
      check(name, "season", "standing present", true, false);
      continue;
    }
    check(name, "season", "rank", expectedStanding.rank, actual.rank);
    check(name, "season", "tiedCount", expectedStanding.tiedCount, actual.tiedCount);
    check(name, "season", "occupiesRanks", expectedStanding.occupiesRanks, actual.occupiesRanks);
    check(
      name,
      "season",
      "cumulativeGrossLossCents",
      expectedStanding.cumulativeGrossLossCents,
      actual.cumulativeGrossLossCents,
    );
    check(name, "season", "payoutPctTotal", expectedStanding.payoutPctTotal, actual.payoutPctTotal);
    check(name, "season", "payoutPctEach", expectedStanding.payoutPctEach, actual.payoutPctEach);
    check(name, "season", "seasonPayoutCents", expectedStanding.seasonPayoutCents, actual.seasonPayoutCents);
    check(
      name,
      "season",
      "payoutRoundingCentAdded",
      expectedStanding.payoutRoundingCentAdded,
      actual.payoutRoundingCentAdded,
    );
    check(
      name,
      "season",
      "totalWeeklyWinningsCents",
      expectedStanding.totalWeeklyWinningsCents,
      actual.totalWeeklyWinningsCents,
    );
    check(
      name,
      "season",
      "totalDenzilAwardCents",
      expectedStanding.totalDenzilAwardCents,
      actual.totalDenzilAwardCents,
    );
    check(name, "season", "netSettleCents", expectedStanding.netSettleCents, actual.netSettleCents);
  }

  // ---- persistence: what landed in week_result must match what was returned ----
  const weekRows = await db.select().from(week).where(eq(week.seasonId, seasonRow.id));
  const stored = await db
    .select()
    .from(weekResult)
    .where(inArray(weekResult.weekId, weekRows.map((w) => w.id)));
  const weekNumberById = new Map(weekRows.map((w) => [w.id, w.number]));
  const storedByKey = new Map(stored.map((r) => [`${r.seasonEntryId}-${r.weekId}`, r]));

  let persistenceChecked = 0;
  for (const sw of result.weeks) {
    for (const p of sw.settlement.players) {
      const row = storedByKey.get(`${p.seasonEntryId}-${sw.settlement.weekId}`);
      const name = nameByEntry.get(p.seasonEntryId)!;
      const wk = `W${weekNumberById.get(sw.settlement.weekId)} (db)`;
      if (!row) {
        check(name, wk, "week_result row present", true, false);
        continue;
      }
      persistenceChecked++;
      check(name, wk, "wins", p.wins, row.wins);
      check(name, wk, "losses", p.losses, row.losses);
      check(name, wk, "pushes", p.pushes, row.pushes);
      check(name, wk, "rateAppliedCents", p.rateAppliedCents, row.rateAppliedCents);
      check(name, wk, "grossLossCents", p.grossLossCents, row.grossLossCents);
      check(name, wk, "weeklyWinShareCents", p.weeklyWinShareCents, row.weeklyWinShareCents);
      check(name, wk, "denzilAwardCents", p.denzilAwardCents, row.denzilAwardCents);
    }
  }
  if (stored.length !== result.weeks.length * entries.length) {
    check("-", "db", "week_result row count", result.weeks.length * entries.length, stored.length);
  }

  // ---- report ----
  console.log(`\ncompared ${comparisons} values (${persistenceChecked} week_result rows read back)`);
  if (disagreements.length === 0) {
    console.log("\nNO DISAGREEMENTS — engine output matches fixtures/expected.json exactly.");
    return;
  }

  console.log(`\n${disagreements.length} DISAGREEMENT(S):\n`);
  console.table(
    disagreements.slice(0, 100).map((d) => ({
      player: d.player,
      week: d.week,
      field: d.field,
      expected: JSON.stringify(d.expected),
      actual: JSON.stringify(d.actual),
    })),
  );
  if (disagreements.length > 100) {
    console.log(`...and ${disagreements.length - 100} more.`);
  }
  process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
