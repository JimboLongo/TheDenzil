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
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 400 }}>
      <h1>Sign in</h1>
      <p>Enter the email your commissioner has on file. We&apos;ll send a link.</p>
      {message && <p style={{ color: "#b00020" }}>{message}</p>}
      <form action={requestMagicLink} style={{ display: "grid", gap: "0.5rem" }}>
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <button type="submit">Send magic link</button>
      </form>
    </main>
  );
}
