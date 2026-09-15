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
      style={{
        marginBottom: "1.5rem",
        padding: "0.75rem",
        background: "#fff3cd",
        display: "flex",
        gap: "0.75rem",
        alignItems: "center",
      }}
    >
      <label>
        First Saturday of the season (week 1):{" "}
        <input type="date" name="firstSaturday" required />
      </label>
      <button type="submit" disabled={isPending}>
        Generate weeks 1-18
      </button>
      {result && (
        <span style={{ color: result.ok ? "#8a6d00" : "#b00020" }}>
          {result.message}
        </span>
      )}
    </form>
  );
}
