"use client";

import { useState, useTransition } from "react";
import type { BoardGameRow, ScheduleResult, WeekBoardData } from "./actions";

const ET_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export type WeekOption = {
  id: number;
  number: number;
  status: string;
  type: string;
};

/** datetime-local wants local wall time, not an ISO instant. */
function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sideLabels(g: BoardGameRow): string[] {
  // No line yet: show where the number will go rather than inventing one.
  if (g.unpriced) {
    return g.market === "TOTAL"
      ? ["Over TBD", "Under TBD"]
      : [`${g.awayName} TBD`, `${g.homeName} TBD`];
  }
  if (g.market === "TOTAL") {
    const t = g.totalPoints ?? "?";
    return [`Over ${t}`, `Under ${t}`];
  }
  const n = g.spread ?? "?";
  return [
    `${g.awayName} ${g.favoriteIsHome ? "+" : "-"}${n}`,
    `${g.homeName} ${g.favoriteIsHome ? "-" : "+"}${n}`,
  ];
}

/**
 * Board Builder. Reads like Make Picks on purpose — same stacked header
 * above both sides, same spacing — so the commissioner is looking at the
 * board the players will see rather than a different table of the same
 * data.
 *
 * Checkboxes write board_override rows rather than editing rules: the
 * filters do the bulk work and a checkbox is an exception to them, which
 * is why an overridden game is badged and can be reset to rule-driven.
 */
export function BoardBuilder({
  weeks,
  initial,
  loadWeek,
  setOverride,
  clearOverride,
  saveSchedule,
  refreshSchedule,
  rulesEditor,
}: {
  weeks: WeekOption[];
  initial: WeekBoardData;
  loadWeek: (weekId: number) => Promise<WeekBoardData>;
  setOverride: (weekId: number, gameId: number, action: "INCLUDE" | "EXCLUDE") => Promise<void>;
  clearOverride: (weekId: number, gameId: number) => Promise<void>;
  saveSchedule: (weekId: number, snapshotAt: string, publishAt: string) => Promise<ScheduleResult>;
  refreshSchedule: () => Promise<{ ok: boolean; message: string }>;
  rulesEditor: React.ReactNode;
}) {
  const [data, setData] = useState<WeekBoardData>(initial);
  const [isPending, startTransition] = useTransition();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState(toLocalInput(initial.lineSnapshotAt));
  const [publishAt, setPublishAt] = useState(toLocalInput(initial.publishAt));
  const [scheduleMsg, setScheduleMsg] = useState<ScheduleResult | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<{ ok: boolean; message: string } | null>(null);

  const isPublished = data.linesPublishedAt !== null;
  const includedCount = data.games.filter((g) => (isPublished ? g.isOnBoard : g.included)).length;

  // The board should have gone live and didn't — the publish cron leaves
  // the week upcoming when it's blocked, so say so here too rather than
  // only in a server log the commissioner will never read.
  const publishOverdue =
    !isPublished &&
    data.status === "upcoming" &&
    data.publishAt !== null &&
    new Date(data.publishAt) < new Date();

  function refresh(weekId: number) {
    startTransition(async () => {
      const next = await loadWeek(weekId);
      setData(next);
      setSnapshotAt(toLocalInput(next.lineSnapshotAt));
      setPublishAt(toLocalInput(next.publishAt));
      setScheduleMsg(null);
    });
  }

  function toggle(g: BoardGameRow) {
    if (isPublished) return;
    startTransition(async () => {
      const want = !g.included;
      await setOverride(data.weekId, g.id, want ? "INCLUDE" : "EXCLUDE");
      setData(await loadWeek(data.weekId));
    });
  }

  function clear(g: BoardGameRow) {
    startTransition(async () => {
      await clearOverride(data.weekId, g.id);
      setData(await loadWeek(data.weekId));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Horizontal scroller, not a wrap: 18 tabs would eat a phone screen
          if they wrapped. overflow-x-auto keeps the strip itself scrollable
          so it cannot push the page sideways. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="tablist" aria-label="Week" className="flex w-max gap-1 border-b border-border">
          {weeks.map((w) => {
            const active = w.id === data.weekId;
            return (
              <button
                key={w.id}
                role="tab"
                aria-selected={active}
                disabled={isPending}
                onClick={() => refresh(w.id)}
                className={`min-h-10 shrink-0 rounded-t border border-b-0 px-3 py-1 whitespace-nowrap ${
                  active
                    ? "border-border bg-surface-raised font-semibold"
                    : "border-transparent bg-transparent opacity-70 hover:opacity-100"
                }`}
              >
                <span>Wk {w.number}</span>
                <span className="ml-1 text-xs text-text-muted">{w.status}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-text-muted">
          Week {data.number} - {data.type} ({data.status}) &middot; {includedCount} of{" "}
          {data.games.length} games {isPublished ? "on the published board" : "match the rules"}
          {isPending && " - loading..."}
        </p>
        <button
          type="button"
          disabled={isPending}
          className="min-h-9"
          onClick={() =>
            startTransition(async () => {
              setRefreshMsg(await refreshSchedule());
              setData(await loadWeek(data.weekId));
            })
          }
        >
          Refresh schedule
        </button>
      </div>
      {refreshMsg && (
        <p className={`text-sm ${refreshMsg.ok ? "text-success-fg" : "text-danger-fg"}`}>
          {refreshMsg.message}
        </p>
      )}

      {isPublished && (
        <p className="rounded border border-info-border bg-info px-3 py-2 text-info-fg">
          Published {ET_DATE_FORMAT.format(new Date(data.linesPublishedAt!))} — the board is locked and
          read-only. Changing it now needs an override, which writes a ruling.
        </p>
      )}

      {publishOverdue && (
        <p className="rounded border border-danger-border bg-danger px-3 py-2 text-danger-fg">
          <strong>This board did not go live.</strong> Its publish time (
          {ET_DATE_FORMAT.format(new Date(data.publishAt!))}) has passed and the week is still upcoming
          — usually an empty board or another week already open.
        </p>
      )}

      <section className="rounded border border-border p-3">
        <h2 className="mb-2 font-semibold">Schedule</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Line snapshot (spreads freeze)</span>
            <input
              type="datetime-local"
              value={snapshotAt}
              disabled={isPending}
              onChange={(e) => setSnapshotAt(e.target.value)}
              className="min-h-10"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Publish (board goes live)</span>
            <input
              type="datetime-local"
              value={publishAt}
              disabled={isPending}
              onChange={(e) => setPublishAt(e.target.value)}
              className="min-h-10"
            />
          </label>
          <button
            type="button"
            disabled={isPending}
            className="min-h-10"
            onClick={() =>
              startTransition(async () => {
                setScheduleMsg(await saveSchedule(data.weekId, snapshotAt, publishAt));
                setData(await loadWeek(data.weekId));
              })
            }
          >
            Save schedule
          </button>
        </div>
        <p className="mt-2 text-sm text-text-muted">
          Snapshot taken:{" "}
          {data.snapshotTakenAt ? ET_DATE_FORMAT.format(new Date(data.snapshotTakenAt)) : "not yet"}. Both
          times are handled hourly by scheduled jobs.
        </p>
        {scheduleMsg && (
          <p className={`mt-1 text-sm ${scheduleMsg.ok ? "text-success-fg" : "text-danger-fg"}`}>
            {scheduleMsg.message}
          </p>
        )}
      </section>

      <section className="rounded border border-border">
        <button
          type="button"
          onClick={() => setRulesOpen((v) => !v)}
          className="w-full border-0 bg-transparent text-left font-semibold"
        >
          {rulesOpen ? "▾" : "▸"} Board rules — filters do the bulk work
        </button>
        {rulesOpen && <div className="border-t border-border p-3">{rulesEditor}</div>}
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Games ({data.games.length})</h2>
        {data.games.length === 0 && (
          <p className="rounded border border-warning-border bg-warning px-3 py-2 text-warning-fg">
            No games yet - the schedule feed only reaches about two weeks ahead.
          </p>
        )}
        <ul className="text-sm">
          {data.games.map((g) => {
            const on = isPublished ? g.isOnBoard : g.included;
            return (
              <li key={g.id} className="border-b border-border py-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={isPublished || isPending}
                    onChange={() => toggle(g)}
                    aria-label={`${on ? "Remove from" : "Add to"} board: ${g.awayName} at ${g.homeName} ${g.market}`}
                    className="mt-1 h-5 w-5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {g.awayName} @ {g.homeName}
                      </span>
                      {g.override && (
                        <span className="inline-flex items-center gap-1 rounded border border-warning-border bg-warning px-1.5 py-0.5 text-xs text-warning-fg">
                          override: {g.override.toLowerCase()}
                          {!isPublished && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => clear(g)}
                              title="Clear this override and go back to what the rules say"
                              className="ml-1 border-0 bg-transparent p-0 underline"
                            >
                              clear
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-text-muted">
                      {g.sport} · {g.market === "SPREAD" ? "Spread" : "Total"} ·{" "}
                      {ET_DATE_FORMAT.format(new Date(g.kickoffAt))}
                      {g.unpriced && " - line not set yet"}
                    </div>
                    <div className={`mt-1 flex max-w-xl flex-col gap-1 ${on ? "" : "opacity-50"}`}>
                      {sideLabels(g).map((label) => (
                        <div
                          key={label}
                          className={`min-h-9 w-full rounded border px-3 py-1.5 ${
                            g.unpriced
                              ? "border-dashed border-border-strong text-text-muted italic"
                              : "border-border bg-surface-raised"
                          }`}
                        >
                          {label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
