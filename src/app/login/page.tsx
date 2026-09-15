import { LoginForm } from "./LoginForm";

// Errors Auth.js can bounce back here on its own (an expired or reused
// link, for instance). Failures from the form itself are returned by the
// action and rendered by LoginForm.
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "That email isn't on the league roster. The Denzil is invite-only — an existing member has to sponsor you. Ask your commissioner to add your email, then try again.",
  Verification: "That sign-in link has expired or was already used. Request a fresh one below.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError = error
    ? (ERROR_MESSAGES[error] ?? "Something went wrong signing in. Request a new link below.")
    : null;

  return (
    <main className="flex min-h-[80vh] items-center justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-sm flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">The Denzil</h1>
          <p className="text-text-muted">
            Nine picks a week — spreads and totals across the NFL and college — every week of the
            season. Lowest dollars lost takes the week.
          </p>
        </header>

        <div className="rounded-lg border border-border bg-surface-raised p-4 sm:p-5">
          <p className="mb-4">
            Enter the email your commissioner has on file. We&apos;ll send you a sign-in link — no
            password needed. You&apos;ll stay signed in all season.
          </p>
          <LoginForm initialError={initialError} />
        </div>

        <p className="text-center text-sm text-text-muted">
          Not a member? The Denzil is sponsor-based — ask a current player to put you forward.
        </p>
      </div>
    </main>
  );
}
