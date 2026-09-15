/**
 * Pick grading — spec section 3, Settlement items 2 and 3. Pure: no DB,
 * no dollars, no config. A pick is WIN, LOSS, or PUSH and nothing else.
 */
export type Grade = "WIN" | "LOSS" | "PUSH";

export type SettlementGame = {
  id: number;
  market: "SPREAD" | "TOTAL";
  homeTeamId: number;
  awayTeamId: number;
  favoriteTeamId: number | null;
  spread: string | null;
  totalPoints: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

export type SettlementPick = {
  gameId: number;
  selection: "HOME" | "AWAY" | "OVER" | "UNDER";
};

export function gradePick(pick: SettlementPick, game: SettlementGame): Grade {
  if (game.homeScore === null || game.awayScore === null) {
    throw new Error(`game ${game.id} has no final score — cannot settle a week containing it`);
  }

  if (game.market === "SPREAD") {
    if (pick.selection !== "HOME" && pick.selection !== "AWAY") {
      throw new Error(`game ${game.id} is a spread but the pick selection is ${pick.selection}`);
    }
    if (game.spread === null) {
      throw new Error(`spread game ${game.id} has no spread`);
    }

    // `selection` is the authoritative field; pick.selectedTeamId is a
    // denormalised convenience copy, so the side and the score are both
    // derived from the selection to keep them impossible to disagree.
    const spread = Number(game.spread);
    const pickedHome = pick.selection === "HOME";
    const selectedTeamId = pickedHome ? game.homeTeamId : game.awayTeamId;
    const selectedScore = pickedHome ? game.homeScore : game.awayScore;
    const oppScore = pickedHome ? game.awayScore : game.homeScore;
    const isFavorite = game.favoriteTeamId !== null && selectedTeamId === game.favoriteTeamId;

    const margin = selectedScore - oppScore + (isFavorite ? -spread : spread);
    if (margin > 0) return "WIN";
    if (margin < 0) return "LOSS";
    return "PUSH";
  }

  if (pick.selection !== "OVER" && pick.selection !== "UNDER") {
    throw new Error(`game ${game.id} is a total but the pick selection is ${pick.selection}`);
  }
  if (game.totalPoints === null) {
    throw new Error(`total game ${game.id} has no total`);
  }

  const total = Number(game.totalPoints);
  const combined = game.homeScore + game.awayScore;
  if (combined === total) return "PUSH";
  return combined > total === (pick.selection === "OVER") ? "WIN" : "LOSS";
}
