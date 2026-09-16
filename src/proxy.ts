import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { db } from "./db";
import { player, season, seasonEntry } from "./db/schema";

// Everything except /login (and Next/auth internals) requires a signed-in
// player. /commish/* additionally requires season_entry.role = 'commish'
// for the active season. This is an optimistic/first-line check — every
// commish Server Action re-verifies via requireCommish() too, since Proxy
// coverage can silently disappear from a route (see Next's own guidance).
export default auth(async (req) => {
  const { pathname } = req.nextUrl;

  const email = req.auth?.user?.email;
  if (!email) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith("/commish")) {
    const [playerRow] = await db
      .select({ id: player.id })
      .from(player)
      .where(eq(player.email, email))
      .limit(1);

    if (!playerRow) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const [activeSeason] = await db
      .select({ id: season.id })
      .from(season)
      .where(eq(season.status, "active"))
      .limit(1);

    const [entry] = activeSeason
      ? await db
          .select({ role: seasonEntry.role })
          .from(seasonEntry)
          .where(
            and(
              eq(seasonEntry.playerId, playerRow.id),
              eq(seasonEntry.seasonId, activeSeason.id),
            ),
          )
          .limit(1)
      : [];

    if (!entry || entry.role !== "commish") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  // api/cron is excluded because those routes authenticate with a
  // CRON_SECRET bearer token instead of a player session — running them
  // through the session proxy would just redirect Vercel's scheduler to
  // /login.
  matcher: ["/((?!api/auth|api/cron|login|_next/static|_next/image|favicon.ico).*)"],
};
