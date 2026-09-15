"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import type { Sport } from "@/db/teams";
import {
  boardSizeWarning,
  computeBoardIds,
  type BoardRule,
  type Market,
  type OverridableGame,
  type OverrideAction,
} from "@/lib/board/rules";
import type { PublishResult } from "./actions";

const SPORT_ORDER: Sport[] = ["NFL", "NCAA", "CFL"];
const MARKET_ORDER: Market[] = ["SPREAD", "TOTAL"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ET_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export type GameRow = OverridableGame & {
  homeName: string;
  awayName: string;
  favoriteName: string | null;
  spread: string | null;
  totalPoints: string | null;
  sourceBook: string | null;
};

type TeamOption = { id: number; canonicalName: string };

type SportRuleState = {
  days: Record<Market, Set<number>>;
  hasIncludeList: boolean;
  includeTeamIds: Set<number>;
  hasExcludeList: boolean;
  excludeTeamIds: Set<number>;
};

function initialStateFor(
  sport: Sport,
  initialRules: BoardRule[],
): SportRuleState {
  const sportRules = initialRules.filter((r) => r.sport === sport);
  const spreadRule = sportRules.find((r) => r.market === "SPREAD");
  const totalRule = sportRules.find((r) => r.market === "TOTAL");
  // Include/exclude lists are shared per sport — either market's rule
  // carries the same values, so either one (if present) is authoritative.
  const anyRule = spreadRule ?? totalRule;

  return {
    days: {
      SPREAD: new Set(spreadRule?.daysOfWeek ?? []),
      TOTAL: new Set(totalRule?.daysOfWeek ?? []),
    },
    hasIncludeList: (anyRule?.includeTeamIds ?? null) !== null,
    includeTeamIds: new Set(anyRule?.includeTeamIds ?? []),
    hasExcludeList: (anyRule?.excludeTeamIds ?? null) !== null,
    excludeTeamIds: new Set(anyRule?.excludeTeamIds ?? []),
  };
}

function formatLine(row: GameRow): string {
  if (row.market === "SPREAD") {
    return `${row.favoriteName ?? "?"} -${row.spread ?? "?"}`;
  }
  return `O/U ${row.totalPoints ?? "?"}`;
}

export function RulesEditor({
  initialRules,
  games,
  teamsBySport,
  initialOverrides,
  saveRulesAction,
  publishBoardAction,
  setOverrideAction,
}: {
  weekId: number;
  initialRules: BoardRule[];
  games: GameRow[];
  teamsBySport: Record<Sport, TeamOption[]>;
  initialOverrides: { gameId: number; action: OverrideAction }[];
  saveRulesAction: (formData: FormData) => Promise<void>;
  publishBoardAction: (formData: FormData) => Promise<PublishResult>;
  setOverrideAction: (gameId: number, action: OverrideAction) => Promise<void>;
}) {
  const [ruleState, setRuleState] = useState<Record<Sport, SportRuleState>>(
    () => {
      const state = {} as Record<Sport, SportRuleState>;
      for (const sport of SPORT_ORDER) {
        state[sport] = initialStateFor(sport, initialRules);
      }
      return state;
    },
  );
  const [isPending, startTransition] = useTransition();
  const [publishResult, setPublishResult] = useState<PublishResult | null>(
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  const overridesMap = useMemo(
    () => new Map(initialOverrides.map((o) => [o.gameId, o.action])),
    [initialOverrides],
  );

  const rules: BoardRule[] = useMemo(() => {
    return SPORT_ORDER.flatMap((sport) => {
      const s = ruleState[sport];
      const includeTeamIds = s.hasIncludeList ? [...s.includeTeamIds] : null;
      const excludeTeamIds = s.hasExcludeList ? [...s.excludeTeamIds] : null;

      return MARKET_ORDER.flatMap((market) => {
        const days = s.days[market];
        if (days.size === 0) return [];
        return [
          {
            sport,
            market,
            daysOfWeek: [...days],
            includeTeamIds,
            excludeTeamIds,
          },
        ];
      });
    });
  }, [ruleState]);

  const previewIds = useMemo(
    () => new Set(computeBoardIds(games, rules, overridesMap)),
    [games, rules, overridesMap],
  );

  function toggleDay(sport: Sport, market: Market, day: number) {
    setRuleState((prev) => {
      const next = new Set(prev[sport].days[market]);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return {
        ...prev,
        [sport]: { ...prev[sport], days: { ...prev[sport].days, [market]: next } },
      };
    });
  }

  function setHasIncludeList(sport: Sport, hasIncludeList: boolean) {
    setRuleState((prev) => ({
      ...prev,
      [sport]: { ...prev[sport], hasIncludeList },
    }));
  }

  function setIncludeTeamIds(sport: Sport, ids: number[]) {
    setRuleState((prev) => ({
      ...prev,
      [sport]: { ...prev[sport], includeTeamIds: new Set(ids) },
    }));
  }

  function setHasExcludeList(sport: Sport, hasExcludeList: boolean) {
    setRuleState((prev) => ({
      ...prev,
      [sport]: { ...prev[sport], hasExcludeList },
    }));
  }

  function setExcludeTeamIds(sport: Sport, ids: number[]) {
    setRuleState((prev) => ({
      ...prev,
      [sport]: { ...prev[sport], excludeTeamIds: new Set(ids) },
    }));
  }

  // An override click always saves the currently-displayed rules first
  // (from the live DOM, not stale props) — otherwise the revalidation
  // that follows the override would refetch the page and silently
  // discard whatever the commissioner had checked but not saved yet.
  function handleOverride(gameId: number, action: OverrideAction) {
    startTransition(async () => {
      if (formRef.current) {
        await saveRulesAction(new FormData(formRef.current));
      }
      await setOverrideAction(gameId, action);
    });
  }

  function handlePublish() {
    startTransition(async () => {
      if (!formRef.current) return;
      const result = await publishBoardAction(new FormData(formRef.current));
      setPublishResult(result);
    });
  }

  return (
    <form ref={formRef} className="grid gap-6">
      <section>
        <h2>Board rules</h2>
        {SPORT_ORDER.map((sport) => {
          const s = ruleState[sport];
          const teams = teamsBySport[sport] ?? [];
          return (
            <fieldset key={sport} className="mb-4 rounded border border-border p-3">
              <legend>{sport}</legend>

              {MARKET_ORDER.map((market) => (
                <div key={market} className="mb-1.5">
                  <strong className="inline-block w-16">
                    {market}
                  </strong>{" "}
                  {DAY_LABELS.map((label, day) => (
                    <label key={day} className="mr-2">
                      <input
                        type="checkbox"
                        name={`rule_${sport}_${market}_day_${day}`}
                        checked={s.days[market].has(day)}
                        onChange={() => toggleDay(sport, market, day)}
                      />{" "}
                      {label}
                    </label>
                  ))}
                </div>
              ))}

              <div className="mt-2 flex flex-wrap gap-6">
                <div>
                  <label>
                    <input
                      type="checkbox"
                      name={`rule_${sport}_hasInclude`}
                      checked={s.hasIncludeList}
                      onChange={(e) =>
                        setHasIncludeList(sport, e.target.checked)
                      }
                    />{" "}
                    Only these teams
                  </label>
                  {s.hasIncludeList && (
                    <select
                      multiple
                      name={`rule_${sport}_includeTeamIds`}
                      value={[...s.includeTeamIds].map(String)}
                      onChange={(e) =>
                        setIncludeTeamIds(
                          sport,
                          Array.from(e.target.selectedOptions).map((o) =>
                            Number(o.value),
                          ),
                        )
                      }
                      size={Math.min(8, teams.length || 1)}
                      className="block min-w-60 rounded border border-border bg-surface-raised"
                    >
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.canonicalName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label>
                    <input
                      type="checkbox"
                      name={`rule_${sport}_hasExclude`}
                      checked={s.hasExcludeList}
                      onChange={(e) =>
                        setHasExcludeList(sport, e.target.checked)
                      }
                    />{" "}
                    Exclude these teams
                  </label>
                  {s.hasExcludeList && (
                    <select
                      multiple
                      name={`rule_${sport}_excludeTeamIds`}
                      value={[...s.excludeTeamIds].map(String)}
                      onChange={(e) =>
                        setExcludeTeamIds(
                          sport,
                          Array.from(e.target.selectedOptions).map((o) =>
                            Number(o.value),
                          ),
                        )
                      }
                      size={Math.min(8, teams.length || 1)}
                      className="block min-w-60 rounded border border-border bg-surface-raised"
                    >
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.canonicalName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </fieldset>
          );
        })}
      </section>

      <section>
        <p className="font-bold">
          {previewIds.size} game(s) match these rules
        </p>
        {previewIds.size === 0 ? (
          <p className="rounded border border-danger-border bg-danger px-3 py-2 text-danger-fg">
            Board is empty — Publish is blocked until at least one game is
            included.
          </p>
        ) : (
          boardSizeWarning(previewIds.size) && (
            <p className="rounded border border-warning-border bg-warning px-3 py-2 text-warning-fg">
              {boardSizeWarning(previewIds.size)}
            </p>
          )
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" formAction={saveRulesAction}>
            Save rules
          </button>
          <button
            type="button"
            disabled={isPending || previewIds.size === 0}
            onClick={handlePublish}
          >
            Publish board
          </button>
        </div>
        {publishResult && (
          <p className={publishResult.ok ? "text-success-fg" : "text-danger-fg"}>
            {publishResult.ok
              ? (publishResult.message ?? "Published.")
              : publishResult.message}
          </p>
        )}
      </section>

      {SPORT_ORDER.map((sport) => {
        const sportGames = games.filter((g) => g.sport === sport);
        if (sportGames.length === 0) return null;

        return (
          <section key={sport}>
            <h3>
              {sport} ({sportGames.length})
            </h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border-strong text-left">
                  <th>Matchup</th>
                  <th>Kickoff (ET)</th>
                  <th>Market</th>
                  <th>Line</th>
                  <th>Book</th>
                  <th>Preview</th>
                  <th>Override</th>
                </tr>
              </thead>
              <tbody>
                {sportGames.map((g) => {
                  const inPreview = previewIds.has(g.id);
                  const override = overridesMap.get(g.id);
                  return (
                    <tr key={g.id} className="border-b border-border">
                      <td>
                        {g.awayName} @ {g.homeName}
                      </td>
                      <td>{ET_DATE_FORMAT.format(g.kickoffAt)}</td>
                      <td>{g.market}</td>
                      <td>{formatLine(g)}</td>
                      <td>{g.sourceBook ?? "manual"}</td>
                      <td>
                        {inPreview ? "on" : "off"}
                        {override ? ` (${override.toLowerCase()})` : ""}
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleOverride(g.id, "INCLUDE")}
                        >
                          Force include
                        </button>{" "}
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleOverride(g.id, "EXCLUDE")}
                        >
                          Force exclude
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </form>
  );
}
