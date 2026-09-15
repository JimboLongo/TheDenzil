import type { ReactNode } from "react";

/** Standard page chrome: one place that owns page padding and rhythm. */
export function PageShell({ children }: { children: ReactNode }) {
  return <main className="flex flex-col gap-3 p-4 sm:p-6">{children}</main>;
}
