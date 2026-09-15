"use client";

import { useState, useTransition } from "react";
import type { PickInput, PickSelection, SubmitPicksResult } from "./actions";

const SPORT_ORDER = ["NFL", "NCAA", "CFL"] as const;
const REQUIRED_PICKS = 9;

const ET_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export type BoardGame = {
  id: number;
  sport: "NFL" | "NCAA" | "CFL";
  market: "SPREAD" | "TOTAL";
  kickoffAt: Date;
  homeTeamId: number;
  awayTeamId: number;
  favoriteTeamId: number | null;
  spread: string | null;
  totalPoints: string | null;
  homeName: string;
  awayName: string;
};

type Side = {
  value: PickSelection;
  /** Plain text, for anywhere that needs a string rather than nodes. */
  text: string;
  node: React.ReactNode;
};

function spreadSide(g: BoardGame, side: "HOME" | "AWAY"): Side {
  const n = g.spread ?? "?";
  const isHome = side === "HOME";
  const team = isHome ? g.homeName : g.awayName;
  const isFavorite = isHome === (g.favoriteTeamId === g.homeTeamId);
  const line = `${isFavorite ? "-" : "+"}${n}`;
  return {
    value: side,
    text: `${team} ${line}`,
    node: (
      <>
        <span className="whitespace-nowrap">{team}</span>{" "}
        <span className="whitespace-nowrap">{line}</span>
      </>
    ),
  };
}

/**
 * Totals carry the matchup in the button text, because "Over 44.5" on its
 * own says nothing — on a submitted slip, or anywhere a pick is shown out
 * of context, it has to stand alone. A slash rather than "@" since a total
 * isn't home/away directional.
 *
 * Wrapping: each team name is nowrap so it can never break mid-name, and
 * the only break opportunity inside the matchup is the <wbr> after the
 * slash. Team names contain spaces, so without this the browser would
 * happily split "Southern Mississippi Golden Eagles" across two lines.
 */
function totalSide(g: BoardGame, side: "OVER" | "UNDER"): Side {
  const total = g.totalPoints ?? "?";
  const direction = side === "OVER" ? "Over" : "Under";
  return {
    value: side,
    text: `${g.awayName}/${g.homeName} - ${direction} ${total}`,
    node: (
      <>
        <span className="whitespace-nowrap">{g.awayName}/</span>
        <wbr />
        <span className="whitespace-nowrap">{g.homeName}</span>{" "}
        <span className="whitespace-nowrap">
          - {direction} {total}
        </span>
      </>
    ),
  };
}

/**
 * One game: a header naming the matchup, market and kickoff, then the two
 * sides stacked. Away sits on top and home underneath, matching the
 * "Away @ Home" line in the header so the two read in the same order.
 *
 * The header has to carry the matchup: the same fixture appears twice on
 * the board, once as a spread and once as a total, and a bare "Over 44.5"
 * says nothing about which game it belongs to.
 */
function GameRow({
  g,
  selection,
  now,
  onPick,
}: {
  g: BoardGame;
  selection: PickSelection | undefined;
  now: Date;
  onPick: (selection: PickSelection) => void;
}) {
  const started = g.kickoffAt <= now;

  const sides: Side[] =
    g.market === "SPREAD"
      ? [spreadSide(g, "AWAY"), spreadSide(g, "HOME")]
      : [totalSide(g, "OVER"), totalSide(g, "UNDER")];

  return (
    <li
      className={`grid gap-1 border-b border-border py-3 sm:grid-cols-[1fr_20rem] sm:items-center sm:gap-6 ${
        started ? "opacity-50" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="font-medium">
          {g.awayName} @ {g.homeName}
        </div>
        <div className="text-sm text-text-muted">
          {g.market === "SPREAD" ? "Spread" : "Total"} · {ET_DATE_FORMAT.format(g.kickoffAt)}
          {started && <span className="text-danger-fg"> — started</span>}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {sides.map(({ node, text, value }) => {
          const isSelected = selection === value;
          const isOtherSelected = Boolean(selection) && selection !== value;
          return (
            <button
              key={value}
              type="button"
              disabled={started || isOtherSelected}
              onClick={() => onPick(value)}
              title={isOtherSelected ? "You picked the other side of this game" : text}
              className={`min-h-10 w-full rounded border px-3 py-1.5 text-left disabled:opacity-40 ${
                isSelected
                  ? "border-info-border bg-info font-bold text-info-fg"
                  : "border-border bg-surface-raised"
              }`}
            >
              {node}
            </button>
          );
        })}
        {selection && (
          <p className="text-xs text-text-muted">
            Picked {sides.find((s) => s.value === selection)?.text} — tap it again to clear.
          </p>
        )}
      </div>
    </li>
  );
}

export function PicksForm({
  games,
  speedEligible,
  forcedSpeed,
  hasUsedSpeed,
  submitPicksAction,
}: {
  weekId: number;
  games: BoardGame[];
  speedEligible: boolean;
  forcedSpeed: boolean;
  hasUsedSpeed: boolean;
  submitPicksAction: (
    picks: PickInput[],
    isSpeedDeclared: boolean,
  ) => Promise<SubmitPicksResult>;
}) {
  const [selections, setSelections] = useState<Record<number, PickSelection>>(
    {},
  );
  const [isSpeedDeclared, setIsSpeedDeclared] = useState(forcedSpeed);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SubmitPicksResult | null>(null);
  const [now] = useState(() => new Date());

  const selectedCount = Object.keys(selections).length;

  function pickGame(gameId: number, selection: PickSelection) {
    setSelections((prev) => {
      const next = { ...prev };
      if (next[gameId] === selection) {
        delete next[gameId];
      } else {
        next[gameId] = selection;
      }
      return next;
    });
  }

  function handleSubmit() {
    const picks: PickInput[] = Object.entries(selections).map(
      ([gameId, selection]) => ({ gameId: Number(gameId), selection }),
    );

    startTransition(async () => {
      const r = await submitPicksAction(picks, isSpeedDeclared);
      setResult(r);
    });
  }

  const bySport = SPORT_ORDER.map((sport) => ({
    sport,
    games: games.filter((g) => g.sport === sport),
  })).filter((s) => s.games.length > 0);

  return (
    <div className="grid grid-cols-1 gap-4">
      <p className="text-lg font-bold">
        {selectedCount} of {REQUIRED_PICKS} selected
      </p>

      {speedEligible && (
        <div className="rounded border border-warning-border bg-warning px-3 py-2 text-warning-fg">
          <label>
            <input
              type="checkbox"
              checked={isSpeedDeclared}
              disabled={forcedSpeed || hasUsedSpeed}
              onChange={(e) => setIsSpeedDeclared(e.target.checked)}
            />{" "}
            Declare this as your speed week
          </label>
          <div className="text-sm opacity-80">
            {hasUsedSpeed
              ? "You've already used your speed week this season."
              : forcedSpeed
                ? "This is week 11 — forced to speed since you haven't declared yet (rule 8)."
                : "You have one speed week left this season."}
          </div>
        </div>
      )}

      {bySport.map(({ sport, games: sportGames }) => (
        <section key={sport}>
          <h2 className="mb-1 font-semibold">
            {sport} ({sportGames.length})
          </h2>
          <ul className="text-sm">
            {sportGames.map((g) => (
              <GameRow
                key={g.id}
                g={g}
                selection={selections[g.id]}
                now={now}
                onPick={(selection) => pickGame(g.id, selection)}
              />
            ))}
          </ul>
        </section>
      ))}

      <div>
        <button
          type="button"
          disabled={selectedCount !== REQUIRED_PICKS || isPending}
          onClick={handleSubmit}
        >
          Submit picks
        </button>
      </div>

      {result && (
        <p className={result.ok ? "text-success-fg" : "text-danger-fg"}>
          {result.message}
        </p>
      )}
    </div>
  );
}
