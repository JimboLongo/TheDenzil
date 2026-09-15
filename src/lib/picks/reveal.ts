/**
 * Pick reveal — spec section 3, feature 5.
 *
 * Enforced server-side, per viewer, per game, per request. This function
 * decides visibility; callers must use it to FILTER rows before they
 * reach the client, never to hide them in the UI. A masked pick that
 * still ships in the payload is readable in devtools by anyone in the
 * league, which is the whole failure this rule exists to prevent.
 */
export type RevealViewer = {
  seasonEntryId: number;
  role: "player" | "commish";
};

export type RevealablePick = {
  seasonEntryId: number;
  kickoffAt: Date;
};

export function canSeePick(args: {
  viewer: RevealViewer;
  pick: RevealablePick;
  /** Every active season_entry has a submission row for the week. */
  allSubmitted: boolean;
  now: Date;
}): boolean {
  const { viewer, pick, allSubmitted, now } = args;

  if (pick.seasonEntryId === viewer.seasonEntryId) return true;
  if (allSubmitted) return true;
  if (pick.kickoffAt <= now) return true;
  if (viewer.role === "commish") return true;
  return false;
}
