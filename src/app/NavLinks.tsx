"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "./signout-action";

export type NavItem = { href: string; label: string; commish?: boolean };

/**
 * The nav itself. Client-side only because it needs the active route and
 * the mobile disclosure state.
 *
 * Below 640px the links collapse behind a Menu toggle rather than
 * wrapping — with eight items a wrapped row eats most of a phone screen,
 * and picks mostly get made on a phone.
 */
export function NavLinks({
  items,
  displayName,
}: {
  items: NavItem[];
  displayName: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the menu whenever the route changes, including back/forward.
  // Adjusted during render rather than in an effect — setState in an
  // effect here would just cause a second render pass.
  const [renderedAt, setRenderedAt] = useState(pathname);
  if (renderedAt !== pathname) {
    setRenderedAt(pathname);
    setOpen(false);
  }

  // The one page that must never show nav.
  if (pathname === "/login") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="border-b border-black/10 dark:border-white/15 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight">The Denzil</span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="primary-nav"
            className="sm:hidden rounded border border-black/20 dark:border-white/25 px-2 py-1 text-xs"
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {displayName && <span className="opacity-60 hidden sm:inline">{displayName}</span>}
          <form action={signOutAction}>
            <button type="submit" className="underline underline-offset-4 opacity-70 hover:opacity-100">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <ul
        id="primary-nav"
        className={`${open ? "flex" : "hidden"} sm:flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-2 px-4 pb-2 sm:items-center`}
      >
        {displayName && (
          <li className="sm:hidden opacity-60 py-1">{displayName}</li>
        )}
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "block rounded px-2 py-1",
                  active
                    ? "font-semibold underline underline-offset-4"
                    : "opacity-70 hover:opacity-100",
                  item.commish ? "italic" : "",
                ].join(" ")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
