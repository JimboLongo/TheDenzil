"use client";

import { useActionState } from "react";
import { requestMagicLink, type MagicLinkResult } from "./actions";

/**
 * Sign-in form. Client-side for the pending state and to swap in the
 * confirmation screen without a round trip that would lose the address
 * we just sent to.
 *
 * Controls are min-h-11 (44px) so they're a comfortable tap target —
 * most sign-ins happen on a phone.
 */
export function LoginForm({ initialError }: { initialError: string | null }) {
  const [state, formAction, isPending] = useActionState<MagicLinkResult | null, FormData>(
    requestMagicLink,
    null,
  );

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded border border-success-border bg-success px-4 py-3 text-success-fg">
          <p className="text-lg font-semibold">Check your email</p>
          <p className="mt-1">
            We sent a sign-in link to <strong className="break-all">{state.email}</strong>.
          </p>
        </div>
        <p className="text-sm text-text-muted">
          The link signs you straight in — no password. It can take a minute to arrive, and it&apos;s
          worth checking spam. You can close this tab; the link works from anywhere.
        </p>
        <form action={formAction}>
          <input type="hidden" name="email" value={state.email} />
          <button type="submit" className="min-h-11 w-full" disabled={isPending}>
            {isPending ? "Sending…" : "Send it again"}
          </button>
        </form>
      </div>
    );
  }

  const message = state && !state.ok ? state.message : initialError;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {message && (
        <p
          role="alert"
          className="rounded border border-danger-border bg-danger px-3 py-2 text-danger-fg"
        >
          {message}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          required
          placeholder="you@example.com"
          disabled={isPending}
          className="min-h-11 w-full text-base"
        />
      </div>

      <button type="submit" disabled={isPending} className="min-h-11 w-full font-medium">
        {isPending ? "Sending your link…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
