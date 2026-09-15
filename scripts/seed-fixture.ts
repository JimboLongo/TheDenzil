import { db } from "../src/db";
import { deleteFixtureSeason, FIXTURE_SEASON_LABEL } from "../src/db/fixture";
import {
  game,
  pick,
  player,
  season,
  seasonEntry,
  submission,
  team,
  week,
} from "../src/db/schema";

/**
 * Builds a complete, self-contained 18-week / 25-player season for
 * exercising the settlement engine (Phase D) before it's plugged into
 * anything live. Every game is already final, every kickoff is in the
 * past, and the roster is deliberately engineered to hit specific
 * scoring edge cases — see ROSTER below for exactly who does what.
 *
 * Deliberately does NOT replay settlement or compute grossLossCents /
 * ranks / awards anywhere in this file. It only decides, player by
 * player and week by week, how many of that player's 9 picks win, lose,
 * or push — the settlement engine is what's being tested, so this
 * script must not pre-answer the question it's supposed to check.
 *
 * ## Fixture scenarios (player name → week)
 *   - Denzil Once   — 0-9 in week 4 (single Denzil Award)
 *   - Mary Rose     — 9-0 in week 7
 *   - Tri Tie A/B/C — 8-1 in week 2 (three-way weekly-winner tie)
 *   - Denzil Quad   — 0-9 in weeks 3, 5, 10, 15 (cap tests at 3 awards)
 *   - Speedy Gonzalez — declares speed in week 6
 *   - No Show       — no submission at all in week 9 (rule 12 auto-loss)
 *   - Eighth Tie A/B/C — cumulative losses through week 11 engineered to
 *     tie exactly at the rank 7/8/9 boundary, so the week-12 handicap
 *     cutoff has to include all three ("all those tied for eighth")
 *   - Push Pete     — week 8, one pick lands on an exact spread push
 *   - Push Paula    — week 11, one pick lands on a TOTAL that pushes
 *     exactly on the number
 *   - Payout Tie A/B — identical loss counts in all 18 weeks, so they
 *     finish tied to the cent inside the top 8 (ranks 3 and 4). Exercises
 *     the season-standings tie rule: the pair splits 15% + 11% = 26%,
 *     13% each, and the next player down is rank 5.
 *   - Week 18 is isSpeedWeekForAll for everyone (no per-player flag needed)
 *   - Every player except Speedy Gonzalez has never declared speed
 *     entering week 11, so week 11 is recorded as forced-speed (rule 8)
 *     for all 24 of them — an emergent, unrequested-but-free test of
 *     that rule across nearly the whole roster.
 *
 * Run: npm run seed:fixture (idempotent — deletes any prior fixture
 * season first). Cleanup only: npm run seed:fixture:reset.
 */

// ---------------------------------------------------------------------
// Seeded RNG (mulberry32) — used only for choices with no scripted
// outcome: team pairing order, spread/total line values, decisive-game
// margins, which specific games satisfy an unconstrained win/loss slot,
// and the loss counts for weeks 12-18 (which carry no hand-verification
// requirement beyond Denzil Quad's week 15). Consumed in a fixed loop
// order (week outer, player inner) so re-running reproduces byte-
// identical output.
// ---------------------------------------------------------------------
const FIXTURE_SEED = 20260913;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(FIXTURE_SEED);

function rngInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function rngPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function seededShuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------
// Season config (spec section 2 defaults) and calendar
// ---------------------------------------------------------------------
const SEASON_CONFIG = {
  entryFeeCents: 3500,
  baseLossCents: 200,
  leaderLossCents: 225,
  speedLossCents: 400,
  weeklyPoolPerLossCents: 175,
  picksPerWeek: 9,
  leaderCount: 8,
  leaderWeekRange: [12, 17],
  speedEligibleWeeks: [1, 11],
  defaultSpeedWeek: 11,
  finalSpeedWeek: 18,
  denzilAwardCents: 7500,
  denzilCapPerSeason: 3,
  seasonPayoutPct: [36, 18, 15, 11, 8, 6, 4, 2],
  lineSnapshotDow: 4,
  lineSnapshotTime: "20:00",
};

// Week 1 kickoff base; all 18 weeks land well before "now" regardless
// of when this is run, since the whole season is 2025-09 -> 2026-01.
const SEASON_START = new Date("2025-09-07T17:00:00.000Z");
function weekKickoffBase(weekNumber: number): Date {
  return new Date(SEASON_START.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------
const SPECIAL_NAMES: Record<number, string> = {
  1: "Denzil Once",
  2: "Mary Rose",
  3: "Tri Tie A",
  4: "Tri Tie B",
  5: "Tri Tie C",
  6: "Denzil Quad",
  7: "Speedy Gonzalez",
  8: "No Show",
  9: "Eighth Tie A",
  10: "Eighth Tie B",
  11: "Eighth Tie C",
  12: "Push Pete",
  13: "Push Paula",
  14: "Payout Tie A",
  15: "Payout Tie B",
};

type PlayerDef = { idx: number; rollupKey: string; name: string };

const PLAYERS: PlayerDef[] = Array.from({ length: 25 }, (_, i) => {
  const idx = i + 1;
  const name = SPECIAL_NAMES[idx] ?? `Filler ${String(idx - 13).padStart(2, "0")}`;
  return { idx, rollupKey: `FIXTURE-P${String(idx).padStart(2, "0")}`, name };
});

// ---------------------------------------------------------------------
// Weeks 1-11 loss counts, hand-engineered per player so that cumulative
// dollars entering week 12 sort into: 6 players strictly better than
// Eighth Tie A/B/C, those three exactly tied, and 16 players strictly
// worse. See the design notes in the conversation this script came
// from for the arithmetic; the short version: Eighth Tie A/B/C run an
// identical 4-losses-every-week pattern (so their dollar totals match
// bit-for-bit regardless of week 11's forced-speed rate), the "better"
// six sit comfortably below that, and the "worse" sixteen sit
// comfortably above it — margins are at least $16 in every direction.
//
// Index [playerIdx - 1][week - 1] = losses that week. Forced cells:
// P1 week4=9 (Denzil Once), P2 week7=0 (Mary Rose), P3/4/5 week2=1
// (three-way tie), P6 weeks 3/5/10=9 (Denzil Quad, 3 of its 4). P8's
// week9 cell is unused (No Show has no submission that week at all).
// P12/P13's week8/week11 loss counts already account for their 1 push
// (losses + push + wins = 9).
// ---------------------------------------------------------------------
const LOSS_TABLE_W1_11: number[][] = [
  /* 1  Denzil Once    */ [5, 5, 5, 9, 5, 5, 5, 5, 5, 5, 5],
  /* 2  Mary Rose      */ [2, 2, 2, 2, 2, 2, 0, 2, 2, 2, 2],
  /* 3  Tri Tie A      */ [5, 1, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  /* 4  Tri Tie B      */ [5, 1, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  /* 5  Tri Tie C      */ [5, 1, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  /* 6  Denzil Quad    */ [4, 4, 9, 4, 9, 4, 4, 4, 4, 9, 4],
  /* 7  Speedy Gonzalez*/ [5, 5, 5, 5, 5, 4, 5, 5, 5, 5, 5],
  /* 8  No Show        */ [5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5],
  /* 9  Eighth Tie A   */ [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  /* 10 Eighth Tie B   */ [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  /* 11 Eighth Tie C   */ [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  /* 12 Push Pete      */ [5, 5, 5, 5, 5, 5, 5, 4, 5, 5, 5],
  /* 13 Push Paula     */ [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4],
  /* 14 Filler 01      */ [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  /* 15 Filler 02      */ [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  /* 16 Filler 03      */ [2, 3, 4, 3, 2, 3, 4, 2, 3, 2, 3],
  /* 17 Filler 04      */ [4, 2, 3, 4, 3, 2, 4, 3, 2, 4, 3],
  /* 18 Filler 05      */ [3, 4, 2, 3, 4, 3, 2, 4, 3, 3, 4],
  /* 19 Filler 06      */ [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  /* 20 Filler 07      */ [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  /* 21 Filler 08      */ [5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5],
  /* 22 Filler 09      */ [6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6],
  /* 23 Filler 10      */ [5, 5, 6, 6, 5, 5, 6, 6, 5, 5, 6],
  /* 24 Filler 11      */ [6, 6, 5, 5, 6, 6, 5, 5, 6, 6, 5],
  /* 25 Filler 12      */ [5, 6, 6, 5, 5, 6, 6, 5, 5, 6, 6],
];

const NO_SHOW_PLAYER = 8;
const NO_SHOW_WEEK = 9;
const DENZIL_QUAD_PLAYER = 6;
const DENZIL_QUAD_WEEK15 = 15;
const SPEED_DECLARE_PLAYER = 7;
const SPEED_DECLARE_WEEK = 6;
const SPREAD_PUSH_PLAYER = 12;
const SPREAD_PUSH_WEEK = 8;
const TOTAL_PUSH_PLAYER = 13;
const TOTAL_PUSH_WEEK = 11;

// Season-standings payout tie. Payout Tie A/B already share an identical
// weeks 1-11 row (both flat 3s, both $72.00 entering week 12) and neither
// declares speed, pushes, or no-shows. Giving them an identical weeks
// 12-18 pattern too makes their weekly dollars identical at every step,
// so their cumulative can never drift apart — including through the
// weeks 12-17 handicap swings, since identical cumulative means they
// enter or miss the leading eight together. They land mid-top-8, which
// puts the tie on ranks 3 and 4: 15% + 11% = 26%, 13% each.
const SEASON_TIE_PLAYERS = [14, 15];
const SEASON_TIE_LOSSES_W12_18: Record<number, number> = {
  12: 4,
  13: 4,
  14: 4,
  15: 4,
  16: 4,
  17: 4,
  18: 5,
};

type Plan = {
  noShow: boolean;
  wins: number;
  losses: number;
  pushes: number;
  speedDeclared: boolean;
  pushGameOwner: boolean;
};

function buildPlan(playerIdx: number, weekNumber: number): Plan {
  const noShow = playerIdx === NO_SHOW_PLAYER && weekNumber === NO_SHOW_WEEK;
  if (noShow) {
    return { noShow: true, wins: 0, losses: 0, pushes: 0, speedDeclared: false, pushGameOwner: false };
  }

  let losses: number;
  let pushes = 0;

  if (weekNumber <= 11) {
    losses = LOSS_TABLE_W1_11[playerIdx - 1][weekNumber - 1];
    if (playerIdx === SPREAD_PUSH_PLAYER && weekNumber === SPREAD_PUSH_WEEK) pushes = 1;
    if (playerIdx === TOTAL_PUSH_PLAYER && weekNumber === TOTAL_PUSH_WEEK) pushes = 1;
  } else if (playerIdx === DENZIL_QUAD_PLAYER && weekNumber === DENZIL_QUAD_WEEK15) {
    losses = 9;
  } else {
    // Draw first, then override. The tie pair must not shift the shared
    // RNG stream — skipping the draw would change every other player's
    // weeks 12-18 and churn the whole answer key for no reason.
    const drawn = rngInt(2, 7);
    losses = SEASON_TIE_PLAYERS.includes(playerIdx) ? SEASON_TIE_LOSSES_W12_18[weekNumber] : drawn;
  }

  const wins = 9 - losses - pushes;
  const speedDeclared =
    (weekNumber === SPEED_DECLARE_WEEK && playerIdx === SPEED_DECLARE_PLAYER) ||
    (weekNumber === 11 && playerIdx !== SPEED_DECLARE_PLAYER);
  const pushGameOwner =
    (playerIdx === SPREAD_PUSH_PLAYER && weekNumber === SPREAD_PUSH_WEEK) ||
    (playerIdx === TOTAL_PUSH_PLAYER && weekNumber === TOTAL_PUSH_WEEK);

  return { noShow: false, wins, losses, pushes, speedDeclared, pushGameOwner };
}

// ---------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------
type Selection = "HOME" | "AWAY" | "OVER" | "UNDER";

type GameMeta = {
  id: number;
  market: "SPREAD" | "TOTAL";
  homeTeamId: number;
  awayTeamId: number;
  winningSelection: Selection;
  reserved: boolean;
  reservedFor?: number;
};

const SPREAD_VALUES = [3.0, 3.5, 6.0, 6.5, 9.5, 10.5, 13.0, 17.0, 20.5, 24.5];
const TOTAL_VALUES = [38.5, 40.5, 42.5, 44.5, 47.5, 49.5, 50.5, 52.5];
const PUSH_SPREAD_VALUE = 7;
const PUSH_TOTAL_VALUE = 45;

function planSpreadGame(
  homeTeamId: number,
  awayTeamId: number,
  forcePush: boolean,
): {
  favoriteTeamId: number;
  spread: number;
  homeScore: number;
  awayScore: number;
  winningSelection: Selection;
} {
  const favoriteIsHome = rng() < 0.5;
  const favoriteTeamId = favoriteIsHome ? homeTeamId : awayTeamId;
  const spread = forcePush ? PUSH_SPREAD_VALUE : rngPick(SPREAD_VALUES);
  const dogScore = rngInt(10, 24);

  let favScore: number;
  let winningSelection: Selection;

  if (forcePush) {
    favScore = dogScore + spread;
    winningSelection = favoriteIsHome ? "HOME" : "AWAY";
  } else if (rng() < 0.55) {
    // favorite covers, by a comfortable margin regardless of spread's fraction
    favScore = dogScore + Math.ceil(spread) + rngInt(1, 14);
    winningSelection = favoriteIsHome ? "HOME" : "AWAY";
  } else {
    // underdog covers (or wins outright)
    favScore = Math.max(0, dogScore + Math.floor(spread) - rngInt(1, 10));
    winningSelection = favoriteIsHome ? "AWAY" : "HOME";
  }

  return {
    favoriteTeamId,
    spread,
    homeScore: favoriteIsHome ? favScore : dogScore,
    awayScore: favoriteIsHome ? dogScore : favScore,
    winningSelection,
  };
}

function planTotalGame(forcePush: boolean): {
  totalPoints: number;
  homeScore: number;
  awayScore: number;
  winningSelection: Selection;
} {
  const totalPoints = forcePush ? PUSH_TOTAL_VALUE : rngPick(TOTAL_VALUES);
  let combined: number;
  let winningSelection: Selection;

  if (forcePush) {
    combined = PUSH_TOTAL_VALUE;
    winningSelection = "OVER";
  } else if (rng() < 0.5) {
    combined = Math.ceil(totalPoints) + rngInt(1, 14);
    winningSelection = "OVER";
  } else {
    combined = Math.max(0, Math.floor(totalPoints) - rngInt(1, 14));
    winningSelection = "UNDER";
  }

  const homeScore = Math.floor(combined / 2);
  return { totalPoints, homeScore, awayScore: combined - homeScore, winningSelection };
}

async function buildWeekGames(
  weekNumber: number,
  weekId: number,
  nflTeamIds: number[],
  ncaaTeamIds: number[],
): Promise<GameMeta[]> {
  const nflOrder = seededShuffle(nflTeamIds);
  const ncaaOrder = seededShuffle(ncaaTeamIds);

  const base = weekKickoffBase(weekNumber);
  let gameIndex = 0;
  function nextKickoff(): Date {
    const t = new Date(base.getTime() + gameIndex * 3 * 60000);
    gameIndex++;
    return t;
  }

  const rowsToInsert: (typeof game.$inferInsert)[] = [];
  const metaDraft: Omit<GameMeta, "id">[] = [];

  function addSpreadGame(sport: "NFL" | "NCAA", homeTeamId: number, awayTeamId: number, forcePush: boolean, reservedFor?: number) {
    const plan = planSpreadGame(homeTeamId, awayTeamId, forcePush);
    rowsToInsert.push({
      weekId,
      sport,
      homeTeamId,
      awayTeamId,
      kickoffAt: nextKickoff(),
      market: "SPREAD",
      favoriteTeamId: plan.favoriteTeamId,
      spread: String(plan.spread),
      totalPoints: null,
      homeScore: plan.homeScore,
      awayScore: plan.awayScore,
      status: "final",
      source: "manual",
      externalEventId: null,
      sourceBook: null,
      isOnBoard: true,
    });
    metaDraft.push({
      market: "SPREAD",
      homeTeamId,
      awayTeamId,
      winningSelection: plan.winningSelection,
      reserved: forcePush,
      reservedFor,
    });
  }

  function addTotalGame(sport: "NFL" | "NCAA", homeTeamId: number, awayTeamId: number, forcePush: boolean, reservedFor?: number) {
    const plan = planTotalGame(forcePush);
    rowsToInsert.push({
      weekId,
      sport,
      homeTeamId,
      awayTeamId,
      kickoffAt: nextKickoff(),
      market: "TOTAL",
      favoriteTeamId: null,
      spread: null,
      totalPoints: String(plan.totalPoints),
      homeScore: plan.homeScore,
      awayScore: plan.awayScore,
      status: "final",
      source: "manual",
      externalEventId: null,
      sourceBook: null,
      isOnBoard: true,
    });
    metaDraft.push({
      market: "TOTAL",
      homeTeamId,
      awayTeamId,
      winningSelection: plan.winningSelection,
      reserved: forcePush,
      reservedFor,
    });
  }

  // NFL: 10 spread games (nflOrder[0..19]) + 5 total games (nflOrder[20..29])
  for (let i = 0; i < 10; i++) {
    const forcePush = weekNumber === SPREAD_PUSH_WEEK && i === 0;
    addSpreadGame("NFL", nflOrder[i * 2], nflOrder[i * 2 + 1], forcePush, forcePush ? SPREAD_PUSH_PLAYER : undefined);
  }
  for (let i = 0; i < 5; i++) {
    const forcePush = weekNumber === TOTAL_PUSH_WEEK && i === 0;
    addTotalGame("NFL", nflOrder[20 + i * 2], nflOrder[21 + i * 2], forcePush, forcePush ? TOTAL_PUSH_PLAYER : undefined);
  }
  // NCAA: 10 spread games (ncaaOrder[0..19]) + 5 total games (ncaaOrder[20..29])
  for (let i = 0; i < 10; i++) {
    addSpreadGame("NCAA", ncaaOrder[i * 2], ncaaOrder[i * 2 + 1], false);
  }
  for (let i = 0; i < 5; i++) {
    addTotalGame("NCAA", ncaaOrder[20 + i * 2], ncaaOrder[21 + i * 2], false);
  }

  const inserted = await db.insert(game).values(rowsToInsert).returning({ id: game.id });
  return inserted.map((row, i) => ({ id: row.id, ...metaDraft[i] }));
}

// ---------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------
function oppositeSelection(market: "SPREAD" | "TOTAL", winning: Selection): Selection {
  if (market === "SPREAD") return winning === "HOME" ? "AWAY" : "HOME";
  return winning === "OVER" ? "UNDER" : "OVER";
}

function selectedTeamIdFor(g: GameMeta, selection: Selection): number | null {
  if (g.market === "TOTAL") return null;
  return selection === "HOME" ? g.homeTeamId : g.awayTeamId;
}

function selectPicksForPlan(
  plan: Plan,
  playerIdx: number,
  weekGames: GameMeta[],
): { gameId: number; selection: Selection; selectedTeamId: number | null }[] {
  const picks: { gameId: number; selection: Selection; selectedTeamId: number | null }[] = [];

  if (plan.pushGameOwner) {
    const reserved = weekGames.find((g) => g.reserved && g.reservedFor === playerIdx);
    if (!reserved) throw new Error(`no reserved push game found for player ${playerIdx}`);
    const selection: Selection = reserved.market === "SPREAD" ? "HOME" : "OVER";
    picks.push({ gameId: reserved.id, selection, selectedTeamId: selectedTeamIdFor(reserved, selection) });
  }

  const normalGames = seededShuffle(weekGames.filter((g) => !g.reserved));
  let ptr = 0;

  for (let i = 0; i < plan.wins; i++) {
    const g = normalGames[ptr++];
    picks.push({ gameId: g.id, selection: g.winningSelection, selectedTeamId: selectedTeamIdFor(g, g.winningSelection) });
  }
  for (let i = 0; i < plan.losses; i++) {
    const g = normalGames[ptr++];
    const selection = oppositeSelection(g.market, g.winningSelection);
    picks.push({ gameId: g.id, selection, selectedTeamId: selectedTeamIdFor(g, selection) });
  }

  return picks;
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  console.log("cleaning up any existing fixture season...");
  await deleteFixtureSeason();

  console.log("creating fixture teams...");
  const nflTeamRows = await db
    .insert(team)
    .values(
      Array.from({ length: 32 }, (_, i) => ({
        sport: "NFL" as const,
        canonicalName: `Fixture NFL ${String(i + 1).padStart(2, "0")}`,
        isActive: true,
      })),
    )
    .returning({ id: team.id });
  const ncaaTeamRows = await db
    .insert(team)
    .values(
      Array.from({ length: 40 }, (_, i) => ({
        sport: "NCAA" as const,
        canonicalName: `Fixture NCAA ${String(i + 1).padStart(2, "0")}`,
        isActive: true,
      })),
    )
    .returning({ id: team.id });
  const nflTeamIds = nflTeamRows.map((r) => r.id);
  const ncaaTeamIds = ncaaTeamRows.map((r) => r.id);

  console.log("creating fixture season...");
  const [seasonRow] = await db
    .insert(season)
    .values({ label: FIXTURE_SEASON_LABEL, status: "fixture", config: SEASON_CONFIG })
    .returning({ id: season.id });

  console.log("creating 25 fixture players + season entries...");
  const playerRows = await db
    .insert(player)
    .values(PLAYERS.map((p) => ({ rollupKey: p.rollupKey, currentDisplayName: p.name, email: null, isActive: true })))
    .returning({ id: player.id });

  const entryRows = await db
    .insert(seasonEntry)
    .values(
      PLAYERS.map((p, i) => ({
        seasonId: seasonRow.id,
        playerId: playerRows[i].id,
        displayName: p.name,
        entryFeePaidAt: new Date(SEASON_START.getTime() - 7 * 24 * 60 * 60 * 1000),
        seasonPoolEligible: true,
        role: "player" as const,
      })),
    )
    .returning({ id: seasonEntry.id });

  const entryIdByPlayerIdx = new Map<number, number>();
  PLAYERS.forEach((p, i) => entryIdByPlayerIdx.set(p.idx, entryRows[i].id));

  for (let weekNumber = 1; weekNumber <= 18; weekNumber++) {
    const base = weekKickoffBase(weekNumber);
    const [weekRow] = await db
      .insert(week)
      .values({
        seasonId: seasonRow.id,
        number: weekNumber,
        type: "regular",
        status: "settling",
        startsAt: base,
        endsAt: new Date(base.getTime() + 2 * 24 * 60 * 60 * 1000),
        linesPublishedAt: new Date(base.getTime() - 3 * 24 * 60 * 60 * 1000),
        lineSnapshotAt: new Date(base.getTime() - 3 * 24 * 60 * 60 * 1000),
        isSpeedWeekForAll: weekNumber === 18,
      })
      .returning({ id: week.id });

    const weekGames = await buildWeekGames(weekNumber, weekRow.id, nflTeamIds, ncaaTeamIds);

    const submissionsToInsert: (typeof submission.$inferInsert)[] = [];
    const pickRowsToInsert: (typeof pick.$inferInsert)[] = [];

    for (const p of PLAYERS) {
      const plan = buildPlan(p.idx, weekNumber);
      if (plan.noShow) continue;

      const entryId = entryIdByPlayerIdx.get(p.idx)!;
      const picks = selectPicksForPlan(plan, p.idx, weekGames);

      submissionsToInsert.push({
        seasonEntryId: entryId,
        weekId: weekRow.id,
        submittedAt: new Date(base.getTime() - 60 * 60 * 1000),
        isSpeedDeclared: plan.speedDeclared,
        pickCount: 9,
        isAutoZero: false,
        notes: null,
      });

      for (const pk of picks) {
        pickRowsToInsert.push({
          seasonEntryId: entryId,
          weekId: weekRow.id,
          gameId: pk.gameId,
          selection: pk.selection,
          selectedTeamId: pk.selectedTeamId,
          source: "player" as const,
        });
      }
    }

    await db.insert(submission).values(submissionsToInsert);
    for (let i = 0; i < pickRowsToInsert.length; i += 500) {
      await db.insert(pick).values(pickRowsToInsert.slice(i, i + 500));
    }

    console.log(
      `week ${weekNumber}: ${weekGames.length} games, ${submissionsToInsert.length} submissions, ${pickRowsToInsert.length} picks`,
    );
  }

  console.log(`\nFixture season seeded: "${FIXTURE_SEASON_LABEL}" (season id ${seasonRow.id})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
