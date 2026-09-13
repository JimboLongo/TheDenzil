import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { db } from "./db";
import { account, player, session, user, verificationToken } from "./db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: user,
    accountsTable: account,
    sessionsTable: session,
    verificationTokensTable: verificationToken,
  }),
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      // Resend's shared test sender — works without verifying a domain.
      // Swap for a verified "from" address before this is real-world.
      from: "The Denzil <onboarding@resend.dev>",
    }),
  ],
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // No self-signup (rule 13: membership is sponsor-based). This runs
    // BEFORE the verification email is sent, so an unknown email never
    // gets a link at all — it's rejected at submission with
    // ?error=AccessDenied, which /login renders as a specific message.
    async signIn({ user: signingInUser }) {
      const email = signingInUser.email;
      if (!email) return false;

      const [playerRow] = await db
        .select({ id: player.id })
        .from(player)
        .where(eq(player.email, email))
        .limit(1);

      return Boolean(playerRow);
    },
  },
});
