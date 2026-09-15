"use client";

import { useRef, useState, useTransition } from "react";
import type { GenerateWeeksResult } from "@/db/weeks";

export function GenerateWeeksForm({
  generateWeeksAction,
}: {
  generateWeeksAction: (formData: FormData) => Promise<GenerateWeeksResult>;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<GenerateWeeksResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    startTransition(async () => {
      const r = await generateWeeksAction(formData);
      setResult(r);
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="mb-6 flex items-center gap-3 rounded border border-warning-border bg-warning p-3 text-warning-fg"
    >
      <label>
        First Saturday of the season (week 1):{" "}
        <input type="date" name="firstSaturday" required />
      </label>
      <button type="submit" disabled={isPending}>
        Generate weeks 1-18
      </button>
      {result && (
        <span className={result.ok ? "text-success-fg" : "text-danger-fg"}>
          {result.message}
        </span>
      )}
    </form>
  );
}
