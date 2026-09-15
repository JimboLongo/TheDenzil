import { requestMagicLink } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "This email is not a member of this league. Contact your commissioner.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error
    ? (ERROR_MESSAGES[error] ?? "Something went wrong signing in. Try again.")
    : null;

  return (
    <main className="flex max-w-sm flex-col gap-3 p-4 sm:p-6">
      <h1>Sign in</h1>
      <p>Enter the email your commissioner has on file. We&apos;ll send a link.</p>
      {message && <p className="rounded border border-danger-border bg-danger px-3 py-2 text-danger-fg">{message}</p>}
      <form action={requestMagicLink} className="grid gap-2">
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <button type="submit">Send magic link</button>
      </form>
    </main>
  );
}
