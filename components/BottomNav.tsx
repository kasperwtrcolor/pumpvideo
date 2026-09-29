"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { privyEnabled } from "./PrivyRoot";
import { useTrader } from "./TraderProvider";
import { ChartIcon, HomeIcon, PersonIcon, PlusIcon, StarIcon } from "./Icons";

/**
 * Bottom tab bar, the way modern mobile apps do it.
 *
 * Icons only — no words — at a 28px glyph size with a generous tap target. The
 * account tab shows the trader's avatar once they're signed in, so the bar also
 * answers "am I logged in?" at a glance.
 *
 * Upload sits in the middle slot, which is the one place a five-item bar always
 * has a thumb resting near, and it is the only destination that creates rather
 * than consumes.
 *
 * The bar takes layout space rather than overlaying, so the feed simply gets a
 * shorter viewport and nothing is ever hidden behind it. `env(safe-area-inset-*)`
 * keeps it clear of the iOS home indicator (see `viewportFit: "cover"` in the
 * root layout).
 */
const ITEMS = [
  { href: "/", label: "Feed" },
  { href: "/coins", label: "Coins" },
  { href: "/upload", label: "Upload" },
  { href: "/favorites", label: "Favourites" },
  { href: "/account", label: "Account" },
] as const;

export function BottomNav() {
  const path = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="z-50 shrink-0 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="flex items-stretch">
        {ITEMS.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                aria-label={it.label}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 items-center justify-center transition active:scale-90 ${
                  active ? "text-accent" : "text-muted hover:text-ink"
                }`}
              >
                {it.href === "/" && <HomeIcon className="h-7 w-7" />}
                {it.href === "/coins" && <ChartIcon className="h-7 w-7" />}
                {it.href === "/upload" && <PlusIcon className="h-7 w-7" />}
                {it.href === "/favorites" && <StarIcon className="h-7 w-7" />}
                {it.href === "/account" && <AccountGlyph />}
                <span className="sr-only">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Avatar when signed in, person glyph otherwise.
 *
 * Split so `usePrivy()` is only ever called when a provider actually exists —
 * it throws without one, and hooks cannot be called conditionally.
 */
function AccountGlyph() {
  if (!privyEnabled) return <PersonIcon className="h-7 w-7" />;
  return <AccountGlyphInner />;
}

function AccountGlyphInner() {
  const { authenticated } = usePrivy();
  const { trader } = useTrader();

  if (authenticated && trader?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={trader.avatarUrl}
        alt=""
        className="h-7 w-7 rounded-full object-cover ring-1 ring-line"
        referrerPolicy="no-referrer"
      />
    );
  }
  return <PersonIcon className="h-7 w-7" />;
}
