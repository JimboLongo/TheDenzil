"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  GRID_CELL_KEYS,
  TOTAL_WEEKS,
  type BoardGrid,
  type GridCellKey,
} from "@/lib/board/grid";
import type {
  SaveGridInput,
  SaveGridResult,
  UpdateWeekTypeResult,
} from "./actions";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COLUMN_LABELS: Record<GridCellKey, string> = {
  NFL_SPREAD: "NFL SPREAD",
  NFL_TOTAL: "NFL TOTAL",
  NCAA_SPREAD: "NCAA SPREAD",
  NCAA_TOTAL: "NCAA TOTAL",
};
const WEEK_TYPES = ["regular", "thanksgiving", "bowl", "playoff"] as const;
type WeekType = (typeof WEEK_TYPES)[number];

export type TeamOption = { id: number; canonicalName: string };

export type WeekMeta = {
  number: number;
  weekId: number | null;
  status: string | null;
  type: WeekType | null;
  locked: boolean;
  hasOverride: boolean;
};

function DayPicker({
  days,
  disabled,
  onToggle,
}: {
  days: number[];
  disabled: boolean;
  onToggle: (day: number) => void;
}) {
  const daySet = new Set(days);
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {DAY_LABELS.map((label, day) => (
        <button
          key={day}
          type="button"
          disabled={disabled}
          onClick={() => onToggle(day)}
          title={DAY_NAMES[day]}
          style={{
            width: 20,
            height: 20,
            fontSize: 10,
            lineHeight: "18px",
            padding: 0,
            background: daySet.has(day) ? "#2563eb" : "transparent",
            color: daySet.has(day) ? "#fff" : "inherit",
            border: "1px solid #999",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function cloneCell(cell: BoardGrid[number]): BoardGrid[number] {
  return {
    NFL_SPREAD: [...cell.NFL_SPREAD],
    NFL_TOTAL: [...cell.NFL_TOTAL],
    NCAA_SPREAD: [...cell.NCAA_SPREAD],
    NCAA_TOTAL: [...cell.NCAA_TOTAL],
  };
}

export function BoardConfigGrid({
  initialNflTeamIds,
  initialNcaaTeamIds,
  initialGrid,
  nflTeams,
  ncaaTeams,
  weekMeta,
  saveGridAction,
  updateWeekTypeAction,
}: {
  initialNflTeamIds: number[] | null;
  initialNcaaTeamIds: number[] | null;
  initialGrid: BoardGrid;
  nflTeams: TeamOption[];
  ncaaTeams: TeamOption[];
  weekMeta: WeekMeta[];
  saveGridAction: (input: SaveGridInput) => Promise<SaveGridResult>;
  updateWeekTypeAction: (
    weekId: number,
    type: WeekType,
  ) => Promise<UpdateWeekTypeResult>;
}) {
  const [nflTeamIds, setNflTeamIds] = useState<Set<number>>(
    () => new Set(initialNflTeamIds ?? nflTeams.map((t) => t.id)),
  );
  const [ncaaTeamIds, setNcaaTeamIds] = useState<Set<number>>(
    () => new Set(initialNcaaTeamIds ?? ncaaTeams.map((t) => t.id)),
  );
  const [ncaaFilter, setNcaaFilter] = useState("");
  const [grid, setGrid] = useState<BoardGrid>(initialGrid);
  const [isPending, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<SaveGridResult | null>(null);
  const [isTypePending, startTypeTransition] = useTransition();
  const [typeMessages, setTypeMessages] = useState<Record<number, string>>({});

  const weekMetaByNumber = useMemo(
    () => new Map(weekMeta.map((m) => [m.number, m])),
    [weekMeta],
  );

  function toggleNflTeam(id: number) {
    setNflTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleNcaaTeam(id: number) {
    setNcaaTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCell(weekNumber: number, key: GridCellKey, day: number) {
    if (weekMetaByNumber.get(weekNumber)?.locked) return;
    setGrid((prev) => {
      const days = new Set(prev[weekNumber][key]);
      if (days.has(day)) days.delete(day);
      else days.add(day);
      return {
        ...prev,
        [weekNumber]: {
          ...prev[weekNumber],
          [key]: [...days].sort((a, b) => a - b),
        },
      };
    });
  }

  function applyRowToWeeks(sourceNumber: number, targetNumbers: number[]) {
    setGrid((prev) => {
      const sourceCell = prev[sourceNumber];
      const next = { ...prev };
      for (const n of targetNumbers) {
        if (n === sourceNumber) continue;
        if (weekMetaByNumber.get(n)?.locked) continue;
        next[n] = cloneCell(sourceCell);
      }
      return next;
    });
  }

  function clearColumn(key: GridCellKey) {
    setGrid((prev) => {
      const next = { ...prev };
      for (let n = 1; n <= TOTAL_WEEKS; n++) {
        if (weekMetaByNumber.get(n)?.locked) continue;
        next[n] = { ...next[n], [key]: [] };
      }
      return next;
    });
  }

  function handleTypeChange(weekId: number, type: WeekType) {
    startTypeTransition(async () => {
      const result = await updateWeekTypeAction(weekId, type);
      setTypeMessages((prev) => ({ ...prev, [weekId]: result.message }));
    });
  }

  function handleSave() {
    startTransition(async () => {
      const nflIsAll = nflTeamIds.size === nflTeams.length;
      const ncaaIsAll = ncaaTeamIds.size === ncaaTeams.length;
      const result = await saveGridAction({
        nflTeamIds: nflIsAll ? null : [...nflTeamIds],
        ncaaTeamIds: ncaaIsAll ? null : [...ncaaTeamIds],
        grid,
      });
      setSaveResult(result);
    });
  }

  const filteredNcaaTeams = ncaaTeams.filter((t) =>
    t.canonicalName.toLowerCase().includes(ncaaFilter.toLowerCase()),
  );

  const allWeekNumbers = Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1);
  const weeks1to17 = allWeekNumbers.filter((n) => n !== TOTAL_WEEKS);

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <section style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
        <fieldset style={{ maxWidth: 420 }}>
          <legend>NFL teams ({nflTeamIds.size} of {nflTeams.length})</legend>
          <div style={{ marginBottom: "0.35rem" }}>
            <button type="button" onClick={() => setNflTeamIds(new Set(nflTeams.map((t) => t.id)))}>
              All
            </button>{" "}
            <button type="button" onClick={() => setNflTeamIds(new Set())}>
              None
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "0.15rem 1rem",
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {nflTeams.map((t) => (
              <label key={t.id} style={{ fontSize: "0.9em" }}>
                <input
                  type="checkbox"
                  checked={nflTeamIds.has(t.id)}
                  onChange={() => toggleNflTeam(t.id)}
                />{" "}
                {t.canonicalName}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ maxWidth: 420 }}>
          <legend>
            NCAA teams ({ncaaTeamIds.size} of {ncaaTeams.length})
          </legend>
          <div style={{ marginBottom: "0.35rem" }}>
            <input
              type="text"
              placeholder="Search teams…"
              value={ncaaFilter}
              onChange={(e) => setNcaaFilter(e.target.value)}
              style={{ marginRight: "0.5rem" }}
            />
            <button type="button" onClick={() => setNcaaTeamIds(new Set(ncaaTeams.map((t) => t.id)))}>
              All
            </button>{" "}
            <button type="button" onClick={() => setNcaaTeamIds(new Set())}>
              None
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "0.15rem 1rem",
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {filteredNcaaTeams.map((t) => (
              <label key={t.id} style={{ fontSize: "0.9em" }}>
                <input
                  type="checkbox"
                  checked={ncaaTeamIds.has(t.id)}
                  onChange={() => toggleNcaaTeam(t.id)}
                />{" "}
                {t.canonicalName}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section>
        <div style={{ marginBottom: "0.5rem" }}>
          Clear column:{" "}
          {GRID_CELL_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => clearColumn(key)}
              style={{ marginRight: "0.5rem" }}
            >
              {COLUMN_LABELS[key]}
            </button>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                <th>Week</th>
                <th>Type</th>
                {GRID_CELL_KEYS.map((key) => (
                  <th key={key}>{COLUMN_LABELS[key]}</th>
                ))}
                <th>Bulk</th>
              </tr>
            </thead>
            <tbody>
              {allWeekNumbers.map((n) => {
                const meta = weekMetaByNumber.get(n);
                const locked = meta?.locked ?? false;
                const cell = grid[n];

                return (
                  <tr key={n} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      Week {n}
                      {locked && (
                        <span title="Board published — locked, edit via overrides on the week page">
                          {" "}
                          🔒
                        </span>
                      )}
                      {meta?.hasOverride && (
                        <span title="This week's saved config differs from what the grid produces">
                          {" "}
                          ⚑
                        </span>
                      )}
                      {!meta?.weekId && (
                        <span style={{ color: "#999", fontSize: "0.85em" }}>
                          {" "}
                          (not created yet)
                        </span>
                      )}
                      {meta?.weekId && (
                        <>
                          {" "}
                          <Link href={`/commish/board/${meta.weekId}`} style={{ fontSize: "0.85em" }}>
                            edit
                          </Link>
                        </>
                      )}
                    </td>
                    <td>
                      {meta?.weekId ? (
                        <>
                          <select
                            value={meta.type ?? "regular"}
                            disabled={locked || isTypePending}
                            onChange={(e) =>
                              handleTypeChange(meta.weekId!, e.target.value as WeekType)
                            }
                          >
                            {WEEK_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          {typeMessages[meta.weekId] && (
                            <div style={{ fontSize: "0.75em", color: "#666" }}>
                              {typeMessages[meta.weekId]}
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "#999" }}>—</span>
                      )}
                    </td>
                    {GRID_CELL_KEYS.map((key) => (
                      <td key={key}>
                        <DayPicker
                          days={cell[key]}
                          disabled={locked}
                          onToggle={(day) => toggleCell(n, key, day)}
                        />
                      </td>
                    ))}
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => applyRowToWeeks(n, allWeekNumbers)}
                      >
                        → all weeks
                      </button>{" "}
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => applyRowToWeeks(n, weeks1to17)}
                      >
                        → 1-17
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <button type="button" disabled={isPending} onClick={handleSave}>
          Save grid
        </button>
        {saveResult && (
          <div style={{ marginTop: "0.5rem" }}>
            <p style={{ color: saveResult.ok ? "#8a6d00" : "#b00020" }}>
              {saveResult.message}
            </p>
            {saveResult.skipped.length > 0 && (
              <ul style={{ fontSize: "0.9em", color: "#666" }}>
                {saveResult.skipped.map((s) => (
                  <li key={s.number}>
                    Week {s.number}:{" "}
                    {s.reason === "locked"
                      ? "locked (already published)"
                      : "week not created yet"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
