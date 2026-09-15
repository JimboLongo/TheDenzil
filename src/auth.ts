import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { db } from "./db";
import { account, player, session, user, verificationToken } from "./db/schema";

/** 180 days — long enough to cover a full season end to end. */
export const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

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
  // A season runs September to January, so a player who signs in once in
  // week 1 should still be signed in for the championship game.
  //
  // For database sessions Auth.js writes maxAge onto the session row and
  // then stamps the cookie's Expires from that same row, so this single
  // setting covers both. The cookie carries a real Expires date rather
  // than being a session cookie, which is what makes it survive a
  // browser restart -- verified on the Set-Cookie header, not assumed.
  //
  // updateAge rolls that expiry forward at most once a day, so a player
  // who keeps showing up never approaches the 180-day edge.
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 24 * 60 * 60,
  },
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
