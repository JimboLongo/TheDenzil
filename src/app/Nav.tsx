import { getCurrentWeek } from "@/db/weeks";
import { getCurrentPlayer } from "@/lib/auth/getCurrentPlayer";
import { NavLinks, type NavItem } from "./NavLinks";

/**
 * Server half of the nav: resolves who's signed in and which links they
 * should get, then hands a plain list to the client component that does
 * active-route highlighting and the mobile disclosure.
 *
 * Renders nothing when there's no player record, which is what keeps it
 * off /login for signed-out visitors; NavLinks also hides itself on
 * /login for the case where a signed-in user navigates there.
 */
export async function Nav() {
  const current = await getCurrentPlayer();
  if (!current) return null;

  const { seasonEntry } = current;

  // No season entry means most destinations would just say "you're not
  // entered" — give them Home and a way to sign out rather than a wall
  // of dead links.
  if (!seasonEntry) {
    return <NavLinks items={[{ href: "/", label: "Home" }]} displayName={current.player.currentDisplayName} />;
  }

  const items: NavItem[] = [
    { href: "/", label: "Home" },
    { href: "/picks", label: "Make Picks" },
    { href: "/my-picks", label: "My Picks" },
    { href: "/league-picks", label: "League Picks" },
    { href: "/weekly-results", label: "Weekly Results" },
    { href: "/standings", label: "Standings" },
  ];

  if (seasonEntry.role === "commish") {
    // Only a commish needs the week, so only a commish pays for the lookup.
    const currentWeek = await getCurrentWeek(seasonEntry.seasonId);
    if (currentWeek) {
      items.push({ href: `/commish/board/${currentWeek.id}`, label: "Board Builder", commish: true });
    }
    items.push({
      href: `/commish/config/${seasonEntry.seasonId}`,
      label: "Season Config",
      commish: true,
    });
  }

  return <NavLinks items={items} displayName={seasonEntry.displayName} />;
}
