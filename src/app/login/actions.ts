"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  try {
    await signIn("resend", { email, redirectTo: "/" });
  } catch (error) {
    // signIn() rethrows AuthError instead of redirecting itself when
    // called this way — catch it here and send the code to /login so
    // the page can render a specific message (e.g. AccessDenied).
    if (error instanceof AuthError) {
      redirect(`/login?error=${error.type}`);
    }
    throw error;
  }
}
