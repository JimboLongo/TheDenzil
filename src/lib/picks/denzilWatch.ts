/**
 * Denzil watch — a display-only heuristic for Weekly Results, not a
 * settlement rule. It flags a player who is in real danger of going 0-9.
 *
 * The threshold matters: "mathematically still alive" fires at 0-0 with
 * nine games pending, which is everyone, and a badge everyone wears
 * says nothing. Requiring five losses already on the board means the
 * flag only appears once the week has genuinely gone wrong.
 */
export const DENZIL_WATCH_MIN_LOSSES = 5;

export function isOnDenzilWatch(args: {
  hasSubmitted: boolean;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
}): boolean {
  const { hasSubmitted, wins, losses, pushes, pending } = args;

  // No submission means no Denzil to chase (league rule 7), a win or a
  // push already kills 0-9, and with nothing pending the week is decided
  // — at which point it's either a Denzil or it isn't, not a watch.
  if (!hasSubmitted) return false;
  if (wins > 0 || pushes > 0) return false;
  if (pending <= 0) return false;

  return losses >= DENZIL_WATCH_MIN_LOSSES;
}
