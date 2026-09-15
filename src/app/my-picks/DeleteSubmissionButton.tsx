"use client";

import { useState, useTransition } from "react";
import type { DeleteSubmissionResult } from "./actions";

/**
 * DEVELOPMENT ONLY. Rendered by /my-picks only when NODE_ENV is not
 * production; the action it calls refuses to run there regardless.
 * Styled as an obvious dev affordance so it can't be mistaken for a
 * normal part of the product.
 */
export function DeleteSubmissionButton({
  weekNumber,
  deleteSubmission,
}: {
  weekNumber: number;
  deleteSubmission: () => Promise<DeleteSubmissionResult>;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<DeleteSubmissionResult | null>(null);

  return (
    <div className="mt-2 rounded border border-dashed border-danger-border bg-danger/40 px-3 py-2">
      <p className="text-xs font-semibold tracking-wide text-danger-fg uppercase">
        Dev only — not available in production
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Submissions are one-shot by rule. This exists to retest the pick flow; a real
        correction goes through the commissioner override, which writes a ruling.
      </p>
      <button
        type="button"
        disabled={isPending}
        className="mt-2 min-h-9"
        onClick={() =>
          startTransition(async () => {
            setResult(await deleteSubmission());
          })
        }
      >
        {isPending ? "Deleting…" : `Delete week ${weekNumber} submission`}
      </button>
      {result && (
        <p className={`mt-2 text-sm ${result.ok ? "text-success-fg" : "text-danger-fg"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
