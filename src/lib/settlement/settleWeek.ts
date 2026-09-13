/**
 * The settlement engine — Phase D. Grades every pick, writes
 * week_result, and is the only thing allowed to move a week from
 * 'settling' to 'final'. getCurrentWeek() deliberately never advances
 * a week past 'settling' on its own, because only a real settlement
 * run can decide a week is actually done (see the spec: "Scoring is a
 * pure function, replayed in week order").
 *
 * Not implemented yet.
 */
export async function settleWeek(weekId: number): Promise<never> {
  throw new Error(
    `settleWeek(${weekId}) is not implemented yet — Phase D builds the settlement engine and this transition.`,
  );
}
