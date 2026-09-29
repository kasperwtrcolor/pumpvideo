"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthBridge";
import { BellIcon } from "./Icons";

/**
 * The notification bell, with an unread badge.
 *
 * Polls `?limit=0`, which asks for no rows and only the count — the badge does
 * not need the list, and fetching 30 rows every poll to render a dot would be
 * wasteful.
 *
 * The poll stops entirely when signed out, and pauses while the tab is hidden:
 * a background tab quietly hitting an endpoint every 45 seconds is a cost with
 * no user watching it. Coming back to the tab refetches immediately, so the
 * badge is right the moment it can be seen.
 */
const POLL_MS = 45_000;

export function NotifyBell({ overlay }: { overlay?: boolean }) {
  const { enabled, authenticated, getToken } = useAuth();
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    if (!authenticated) {
      setUnread(0);
      return;
    }
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch("/api/notifications?limit=0", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) return;
      const j = (await r.json()) as { unread?: number };
      setUnread(j.unread ?? 0);
    } catch {
      /* a missed poll is not worth surfacing */
    }
  }, [authenticated, getToken]);

  useEffect(() => {
    if (!enabled || !authenticated) {
      setUnread(0);
      return;
    }
    void load();

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void load();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, authenticated, load]);

  if (!enabled || !authenticated) return null;

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className={`press relative flex h-8 w-8 items-center justify-center rounded-full border ${
        overlay ? "border-white/25 bg-black/35 backdrop-blur" : "border-line bg-panel2"
      }`}
    >
      <BellIcon className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-down px-1 text-[9px] font-black text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
