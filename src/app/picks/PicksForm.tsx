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

function spreadLabels(g: BoardGame): { home: string; away: string } {
  const n = g.spread ?? "?";
  const homeIsFavorite = g.favoriteTeamId === g.homeTeamId;
  return {
    home: `${g.homeName} ${homeIsFavorite ? "-" : "+"}${n}`,
    away: `${g.awayName} ${homeIsFavorite ? "+" : "-"}${n}`,
  };
}

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

  let sideALabel: string;
  let sideAValue: PickSelection;
  let sideBLabel: string;
  let sideBValue: PickSelection;

  if (g.market === "SPREAD") {
    const labels = spreadLabels(g);
    sideALabel = labels.home;
    sideAValue = "HOME";
    sideBLabel = labels.away;
    sideBValue = "AWAY";
  } else {
    sideALabel = `Over ${g.totalPoints ?? "?"}`;
    sideAValue = "OVER";
    sideBLabel = `Under ${g.totalPoints ?? "?"}`;
    sideBValue = "UNDER";
  }

  function renderSide(label: string, value: PickSelection) {
    const isSelected = selection === value;
    const isOtherSelected = Boolean(selection) && selection !== value;
    const disabled = started || isOtherSelected;

    return (
      <div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick(value)}
          className={`rounded border px-2 py-1 text-left disabled:opacity-40 ${
            isSelected
              ? "border-info-border bg-info font-bold text-info-fg"
              : "border-border bg-surface-raised"
          }`}
        >
          {label}
        </button>
        {isOtherSelected && (
          <div className="text-xs text-text-muted">
            you picked the other side
          </div>
        )}
      </div>
    );
  }

  return (
    <tr className={`border-b border-border ${started ? "opacity-50" : ""}`}>
      <td className="p-1.5 whitespace-nowrap align-top">
        {ET_DATE_FORMAT.format(g.kickoffAt)}
        {started && <span className="text-danger-fg"> — started</span>}
      </td>
      <td className="p-1.5 align-top">{renderSide(sideALabel, sideAValue)}</td>
      <td className="p-1.5 align-top">{renderSide(sideBLabel, sideBValue)}</td>
    </tr>
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
    <div className="grid gap-4">
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
          <h2>
            {sport} ({sportGames.length})
          </h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {sportGames.map((g) => (
                <GameRow
                  key={g.id}
                  g={g}
                  selection={selections[g.id]}
                  now={now}
                  onPick={(selection) => pickGame(g.id, selection)}
                />
              ))}
            </tbody>
          </table>
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
