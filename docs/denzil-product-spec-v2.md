# The Denzil — Product Spec v2

Supersedes v1. Changes are marked **[NEW]** or **[CHANGED]**.

## 0. Locked decisions

| Decision | Value |
|---|---|
| Platform | Web first, iOS later |
| Pick entry | Players submit; commissioner can override |
| Data source | the-odds-api.com (paid) |
| Line snapshot | **Thursday 8:00 PM**, per-week configurable |
| Lock model | **Rolling** — any game not yet kicked off is selectable |
| Speed week | Declared **at submission**, once in weeks 1–11; week 18 is speed for all |
| Submission | **One-shot** — one slip per player per week, no amendments |
| Player identity | `Rollup` value from the archive |
| Historical import | 12 seasons, 45,999 picks |

---

## 1. The one architectural rule

**Scoring is a pure function, replayed in week order. Dollars are never stored as source of truth.**

The $2.25 handicap rate applies to the leading eight entering a week, which depends on every prior week's result. Store `player.seasonLoss` and increment it, and a single week-6 correction silently rots weeks 7–18.

```
settleSeason(picks, games, config) -> for week in 1..18:
    standings = cumulative(results[1..week-1])
    rates     = assignRates(standings, week, speedDeclarations, config)
    results[week] = settleWeek(picks[week], games[week], rates)
```

- **All money is integer cents.** `200`, `225`, `400`, `175`, `7500`. No floats.
- **Lines are snapshotted, not referenced.** Thursday 8pm freezes the number onto the `game` row. The API keeps moving all week; the league's line does not.

---

## 2. Data model

### Config (per season — never hardcode)

| Field | Value |
|---|---|
| `entryFeeCents` | 3500 |
| `baseLossCents` | 200 |
| `leaderLossCents` | 225 |
| `speedLossCents` | 400 |
| `weeklyPoolPerLossCents` | 175 |
| `picksPerWeek` | 9 |
| `leaderCount` | 8 |
| `leaderWeekRange` | 12–17 |
| `speedEligibleWeeks` | 1–11 |
| `defaultSpeedWeek` | 11 |
| `finalSpeedWeek` | 18 |
| `denzilAwardCents` | 7500 |
| `denzilCapPerSeason` | 3 |
| `seasonPayoutPct` | [36, 18, 15, 11, 8, 6, 4, 2] |
| `lineSnapshotDow` / `lineSnapshotTime` | Thursday / 20:00 ET |

### Tables

**`player`** — id, **`rollupKey` (unique)**, currentDisplayName, email, isActive
> **[CHANGED]** Identity is the archive's `Rollup` value. 63 display names collapse to 55 identities. Import keys on this and nothing else.

**`season_entry`** — id, seasonId, playerId, **`displayName`** (that season's team name), sponsorPlayerId, entryFeePaidAt, seasonPoolEligible, role (`player` | `commish`)
> **[CHANGED]** Team name is season-scoped, not global. `Swamp Donkeys` → `Swamp Donkeys Revived` → `Swamp Donkey Revival` is one player, three names, and the name history is a feature.

**`season`** — id, label, config JSON, status

**`week`** — id, seasonId, number, type (`regular` | `thanksgiving` | `bowl` | `playoff`), linesPublishedAt, **`lineSnapshotAt`**, isSpeedWeekForAll, allowsStringBetsFromWeek

**`week_board_config`** **[NEW]** — weekId, includedDaysOfWeek (array), includedSports, eligibleTeamIds (nullable = all), maxGames
> Drives the commissioner's board builder. Day-of-week and team filters produce a candidate pool from the API; manual curation trims it to the final 20–40.

**`game`** — id, weekId, sport (`NFL` | `NCAA` | `CFL`), homeTeam, awayTeam, kickoffAt, **`market`** (`SPREAD` | `TOTAL`), favoriteTeamId, spread, totalPoints, homeScore, awayScore, status (`scheduled` | `final` | `postponed` | `void`), externalEventId, sourceBook, isOnBoard
> **[NEW] `market`.** The archive contains 537 over/under picks (`Chiefs/Buccaneers - Over 56.0`) from week-18 playoff boards. Rule 11 requires totals. v1's schema had no concept of them.

**`pick`** — id, seasonEntryId, weekId, gameId, **`selection`** (`HOME` | `AWAY` | `OVER` | `UNDER`), selectedTeamId (null for totals), source (`player` | `commish`), createdAt, overrideResult, overrideNote

**`submission`** — id, seasonEntryId, weekId, submittedAt, **`isSpeedDeclared`**, pickCount, isAutoZero, notes

**`makeup_designation`** — id, seasonEntryId, gameId, designatedInWeek, countsTowardWeek

**`ruling`** — id, weekId, seasonEntryId, type, description, appliedBy, appliedAt. Every override writes one.

**`week_result`** (derived cache, rebuildable) — seasonEntryId, weekId, wins, losses, pushes, rateAppliedCents, grossLossCents, weeklyWinShareCents, denzilAwardCents, rankAfterWeek

---

## 3. Rules the engine enforces

### Pick validity (feature 3)

1. Exactly 9 selections.
2. Every selected game has `kickoffAt > now`.
3. **No both-sides.** Reject two picks on the same `gameId`. This covers spread-vs-spread, and also Over + Under on the same total.
4. Game must be `isOnBoard = true` for that week.

### Rolling lock **[CHANGED from v1]**

Rule 10's one-shot lock is replaced. A player may submit at any time; they are limited to games that have not started. A player submitting Sunday 11am has seen Saturday's college results and is confined to Sunday and Monday games.

Consequence to accept knowingly: **late submission is strictly advantageous** in information terms and strictly disadvantageous in board size. Early submitters get 30+ games; Sunday submitters get maybe 12. That tradeoff is the game.

**Submission is one-shot.** One `submission` row per player per week, immutable after write. A player picks their moment — Friday for a 30-game board, Sunday for a 12-game board with Saturday's results known — and commits all nine at once. No amendments, no second batch. Only a commissioner can alter a submitted slip, and that writes a `ruling`.

### Speed week declaration **[NEW]**

- A checkbox on the submission screen, submitted together with the nine picks, weeks 1–11 only.
- Server rejects a second declaration if one already exists for the season.
- Week 18 sets `isSpeedWeekForAll`; no declaration needed.
- Week 12–17 submissions show no checkbox.
- If a player reaches week 11 without declaring, week 11 is forced to speed (rule 8).
- Speed replaces the handicap rate; it does not stack. Confirmed by the archive: `Losses` contains only `0`, `-2.00`, `-2.25`, `-4.00`.

### Pick reveal (feature 5)

Enforced **server-side**, per viewer, per game, per request — never as a UI filter, or the hidden picks ship in the JSON payload and are readable in devtools.

```
canSee(viewer, pick):
    pick.seasonEntryId == viewer.seasonEntryId   -> true
    allSubmitted(week)                           -> true
    pick.game.kickoffAt <= now                   -> true
    viewer.role == 'commish'                     -> true
    else                                         -> false
```

`allSubmitted(week)` = every active `season_entry` has a `submission` row for that week.

### Settlement

1. **Rate:** speed (`$4`) if declared or week 18; else handicap (`$2.25`) if week 12–17 and in the leading eight by cumulative gross loss entering the week, ties at 8th included; else base (`$2`).
2. **Grade spreads:** `margin = selectedScore - oppScore + (isFavorite ? -spread : +spread)`. Positive WIN, negative LOSS, zero PUSH ($0).
3. **Grade totals:** `combined = home + away`. Over wins if `combined > total`, Under if `<`, push if `=`.
4. **No submission:** 9 losses at that entry's rate.
5. **Weekly pool:** `Σ losses × 175`. All remainder above $1.75 goes to the season pool, including the handicap $0.50 and speed $2.25 excess. **Pennies too:** when the post-Denzil remainder doesn't divide evenly across tied weekly winners, the 1–2 cents left over go to the season pool as well — same destination as every other remainder.
6. **Denzil Awards:** 0–9 → $75 from the weekly pool, capped 3/season, paid *before* the winner split. **Requires a submission** (league rule 7: "A player must submit selections for the week in order to earn a Denzil Award"). A no-show's rule-4 auto-loss is 0–9 by the numbers and still costs them 9 losses, but earns no award.
7. **Weekly Winner(s):** least **dollars** lost, not fewest losses. A speed player at 1 loss ($4) finishes behind a base player at 1 loss ($2). Split the post-Denzil remainder equally.
8. **Mary Rose:** 9–0, $0.

```
seasonPool = Σ entryFees + Σ (loss remainders above $1.75) + Σ (weekly pool pennies)
standings  = rank by cumulative grossLossCents ASC    // excludes weekly wins + awards
payouts    = seasonPool × [36,18,15,11,8,6,4,2]%
netSettle  = weeklyWinnings + denzilAwards + seasonPayout - grossLoss - entryFee
```

**Season Pool eligibility.** League rule 1: "All entries must be submitted in the first week to be considered eligible for the Season Pool." An entry with `seasonPoolEligible = false` still settles every week — it loses money at its rate, feeds the weekly pool, can take a Denzil Award, and can win a weekly pool — but it is excluded from the season standings and takes no season payout. Its entry fee and loss remainders still fund the season pool; eligibility restricts who can be paid *from* the pool, not who pays *into* it. Ranks are assigned across eligible entries only, so an ineligible entry never displaces anyone.

**Standings ties.** Tied players occupy consecutive rank slots. Sum the payout percentage of every slot the tie occupies and split it evenly across them; the next player down takes the rank after the last occupied slot. Two players tied for 3rd occupy ranks 3 and 4, so they split 15% + 11% = 26% — 13% each — and the next player is rank 5. A tie straddling the payout cutoff works the same way: ranks 8 and 9 split 2% + 0%, so 1% each.

Because the eight percentages sum to 100, the pool is fully distributed by construction. Integer cents still need a tie-break: allocate each share's whole cents first, then hand the leftover pennies to the largest fractional remainders, best rank first. Every cent lands on a player.

Keep weekly winnings and awards visibly separate from standings on every screen, or people will argue.

---

## 4. Screens

### Player
1. **Make Picks** (feature 3) — board grouped NFL / NCAA / CFL, sortable by kickoff or spread, started games disabled and greyed with kickoff time, running "6 of 9", both-sides blocked at selection with an inline reason, speed-week checkbox in weeks 1–11 with a "you have one left" indicator.
2. **My Picks** (feature 4) — current week slip plus full season history, per-pick result, running dollar total.
3. **League Picks** (feature 5) — everyone's board, cells masked until visible per `canSee`, with a banner naming how many players have yet to submit.
4. **Weekly Results** (feature 8) — live records and dollars as games settle, projected weekly winner, Denzil watch for anyone sitting at 0–8.
5. **Standings** (feature 9) — cumulative season dollars, rank, weekly wins, Denzil count, with the top-eight handicap cutoff drawn explicitly in weeks 12–17.
6. **Hall of Fame** (feature 10) — section 6.

### Commissioner **[NEW]**
7. **Board Builder** (feature 1) — select days of week, sports, and eligible teams; pull from API; curate to the final board; publish. Publishing freezes spreads.
8. **Override Console** (feature 3) — edit any pick, force a result, mark postponed, void a game, waive rule 12, re-run settlement. Every action writes a `ruling` row.

### Verification standard **[NEW]**

**Anything visual is verified by rendering it and looking at it.** Screenshot every page it touches, in **both light and dark mode**, at **mobile and desktop widths**. Not a sample of representative pages — every page the change can reach.

**An HTTP 200 with the right text in it is not verification.** Curling a page, extracting its text, and diffing the numbers proves the data layer works. It proves nothing about whether a human can read the result.

This is not hypothetical. Three separate shipped bugs passed text-extraction checks and were caught only by looking at the page:

| Bug | What the text check saw | What the screen showed |
|---|---|---|
| Banner contrast | 200, correct copy | Near-black text on a light banner inside a dark page — unreadable |
| Missing navigation | 200, correct content | Every screen a dead end; the only way back was the browser Back button |
| Invisible form controls | 200, `<input>` present | Preflight had stripped the borders — the sign-in field rendered as blank space |

Each was invisible to text extraction *by construction*: the markup was correct and the copy was right. Contrast, layout, and affordance live entirely in the rendered pixels.

Two consequences worth stating plainly:

- **Both themes, always.** A theme bug is 50% reproducible by definition, and the half you don't use is the half you ship broken. The token layer supports an explicit `data-theme` override precisely so the branch you aren't currently in can still be rendered and checked.
- **Mobile is the primary width.** Most picks get made from a phone. A layout verified only at desktop width is verified for the minority case.

---

## 5. Odds & scores integration

**the-odds-api.com** — covers NFL, NCAA, CFL, which is the exact league set. Current odds and scores on all plans.

⚠️ **A lookalike exists at `theoddsapi.com`** (no hyphens), different vendor and pricing. The original publishes an impersonator warning. Check the hyphens before entering a card.

**Flow:**
1. Thursday 8:00 PM — scheduled job snapshots spreads and totals for the candidate pool defined by `week_board_config`.
2. Commissioner curates and publishes. Nothing auto-updates a published line.
3. Scores poll every 10 minutes Saturday through Monday night.
4. The scores job writes final scores only. It never writes `week_result` — settlement always re-runs from scratch.

> **Bowl weeks need an earlier snapshot.** Rule 3 includes Thursday and Friday games during bowl weeks, and a Thursday 8pm snapshot lands after some kick off. Set `lineSnapshotAt` per week.

---

## 6. Hall of Fame (feature 10)

### Available across all 12 archived seasons (record-based)
1. Best season — fewest dollars lost, and best W-L
2. Worst season, and the free-season-pass roll of shame
3. Longest winning and losing streaks, by week
4. Most weekly wins in a season, and all-time
5. Most money won; Denzil and Mary Rose leaderboards

### Available from 2020-21 forward only (pick-level)
- Contrarian rate — picks against the field majority, and win rate on them
- Chalk vs. dog split
- Spread-bucket performance: pick'em–3, 3.5–7, 7.5–14, 14+
- Luck index — record on games decided by ≤1 point against the spread
- Head-to-head matrix on shared games

**Two guardrails:**
- Rank all-time boards by **per-week average**, not totals. Fourteen of 55 players played exactly one season; a totals leaderboard just ranks attendance. Gate all-time boards at a 2–3 season minimum and list one-and-dones separately.
- **Compute career continuity, never infer it.** Dirk appears in the first and last season but missed 2020-21; his longest unbroken run is 5, not 12. Seven of eleven gapped players are missing 2020-21 — COVID, real absences, not missing rows.

---

## 7. Archive import — current state

**45,999 picks, 12 seasons (2014-15 → 2025-26), 5,111 player-weeks, every one exactly 9 picks.** Clean data.

| Seasons | Picks | `Line` content |
|---|---|---|
| 2014-15 → 2019-20 | 25,758 | Empty — record only, permanently |
| 2020-21 → 2021-22 | 7,452 | Parses at 98.7% / 93.4% |
| 2022-23 → 2025-26 | 12,789 | **Unknown format — 0% parse** |

Pre-2020 cannot be rescued from the odds API either; its archive starts mid-2020, so the cutoff is a real boundary rather than a gap worth chasing.

Parsed format: `NFL-02B Sunday, 9/27/2020 1:00 PM Bills -2.5` → sport, game number, side, kickoff, team, spread. The A/B suffix pairs both sides of a game; 866 games reconstruct fully, 783 spread pairs mirror exactly.

**Import sequence:**
1. 55 `player` rows keyed on `Rollup`
2. 356 `season_entry` rows (Rollup × season actually played), carrying that season's `Participant` as `displayName`
3. All 45,999 `pick` rows with Result, Losses, Week Type as recorded
4. Parse `Line` where present into structured games
5. Reconcile recomputed grades against recorded `Losses`; every disagreement is an import bug or an undocumented Exec Committee ruling

Steps 1–3 unlock every record-based Hall of Fame stat across all 12 seasons.

**Do not re-settle history.** Import recorded dollars as authoritative. 2016 rulings aren't reproducible, and the engine will disagree in ways that are correct-by-code and wrong-by-ledger.

---

## 8. Build phases

Estimates assume Claude Code implementing, you reviewing.

| Phase | Scope | Est. |
|---|---|---|
| A | Schema, auth (magic link), team name | ~2 hrs |
| B | Board Builder + odds ingest + Thursday 8pm job | ~5 hrs |
| C | Pick submission, validity rules, speed declaration, My Picks | ~5 hrs |
| D | **Settlement engine + test fixtures** | ~6 hrs |
| E | Reveal logic, Weekly Results, Standings | ~5 hrs |
| F | Archive import + Hall of Fame | ~5 hrs |

**Phase D is the build.** Write it against a hand-computed fixture season first: 25 players, 18 weeks, containing a handicap flip at week 12, a declared speed week, a 0–9, a three-way weekly tie, a no-show, a postponement, and a totals pick. Everything after it is CRUD.

---

## 9. Open rulings

### Before Phase D
1. **Denzil overflow** — three 0–9 weeks, $225 in awards, $180 in the pool. Season pool absorbs it, or prorate?
2. **Make-up game rate** — settles at the prior week's rate or the current week's?
3. **Last-place free pass ties** — two players tied for last: who gets the free season? Section 3's standings-tie rule covers payout ranks, not this.

### Before Phase F
4. **`Line` format for 2022-23 onward** — determines how far back pick-level records reach.
5. **`No Pick` rows** in 2020-21 and 2021-22 — rule 12 auto-losses, or postponements?
