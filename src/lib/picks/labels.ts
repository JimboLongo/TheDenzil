/**
 * Shared pick/matchup formatting for the display screens, so League
 * Picks, Weekly Results and My Picks all describe the same pick the
 * same way.
 */
export type PickLabelInput = {
  market: "SPREAD" | "TOTAL";
  selection: "HOME" | "AWAY" | "OVER" | "UNDER";
  spread: string | null;
  totalPoints: string | null;
  homeName: string;
  awayName: string;
  favoriteIsHome: boolean;
};

export function matchupLabel(homeName: string, awayName: string): string {
  return `${awayName} @ ${homeName}`;
}

/** What the player actually took, with the number attached to it. */
export function pickLabel(input: PickLabelInput): string {
  if (input.market === "TOTAL") {
    const total = input.totalPoints ?? "?";
    return `${input.selection === "OVER" ? "Over" : "Under"} ${total}`;
  }

  const number = input.spread ?? "?";
  const pickedHome = input.selection === "HOME";
  const pickedTeam = pickedHome ? input.homeName : input.awayName;
  const pickedIsFavorite = pickedHome === input.favoriteIsHome;
  return `${pickedTeam} ${pickedIsFavorite ? "-" : "+"}${number}`;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
