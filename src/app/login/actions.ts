"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type MagicLinkResult =
  | { ok: true; email: string }
  | { ok: false; kind: "invalid" | "not-a-member" | "failed"; message: string };

const NOT_A_MEMBER =
  "That email isn't on the league roster. The Denzil is invite-only — an existing member has to sponsor you. Ask your commissioner to add your email, then try again.";

/**
 * Requests a magic link. Uses redirect: false so the result comes back
 * here instead of bouncing the browser, which is what lets the page show
 * a "check your email" confirmation naming the address.
 *
 * An unknown email never gets a link: the signIn callback rejects it
 * before the mail is sent (rule 13, membership is sponsor-based), which
 * surfaces as AccessDenied.
 */
export async function requestMagicLink(
  _previous: MagicLinkResult | null,
  formData: FormData,
): Promise<MagicLinkResult> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return { ok: false, kind: "invalid", message: "Enter a valid email address." };
  }

  try {
    await signIn("resend", { email, redirect: false });
    return { ok: true, email };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "AccessDenied") {
        return { ok: false, kind: "not-a-member", message: NOT_A_MEMBER };
      }
      return {
        ok: false,
        kind: "failed",
        message: "We couldn't send the link just now. Try again in a moment.",
      };
    }
    throw error;
  }
}
