"use client";

import { useCallback, useState } from "react";
import { useAuth } from "./AuthBridge";
import { UserCheckIcon, UserPlusIcon } from "./Icons";

/**
 * Follow / Following, for accounts and for tokens.
 *
 * One component because the interaction is identical and only the endpoint and
 * the nouns differ — and because the details that make a follow button feel
 * right are easy to get wrong twice:
 *
 *   - it flips *optimistically* and only reverts if the request actually fails.
 *     A button that waits for a round trip reads as broken on a slow connection,
 *     and the server is idempotent, so a wrong guess is cheap and correctable.
 *   - a signed-out tap opens the login rather than failing, because "log in to
 *     follow" is the real next step and a silent failure is not.
 *   - it never renders for your own account.
 */
function useToggleFollow(kind: "user" | "token") {
  const { enabled, authenticated, login, getToken } = useAuth();
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(
    async (
      key: string,
      current: boolean,
      onState: (next: boolean) => void,
      onError: (msg: string) => void,
    ) => {
      if (!enabled || !authenticated) {
        login();
        return;
      }
      if (busy) return;
      setBusy(true);
      const optimistic = !current;
      onState(optimistic);
      try {
        const token = await getToken();
        if (!token) throw new Error("session expired — log in again");
        const body = kind === "user" ? { traderId: key } : { mint: key };
        const r = await fetch(kind === "user" ? "/api/follow" : "/api/token-follow", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        const j = (await r.json()) as { following?: boolean; detail?: string; error?: string };
        if (!r.ok) throw new Error(j.detail || j.error || "could not follow");
        if (typeof j.following === "boolean") onState(j.following);
      } catch (e) {
        onState(current); // put it back
        onError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, enabled, authenticated, getToken, kind, login],
  );

  return toggle;
}

const SIZES = {
  sm: "gap-1 px-2.5 py-1 text-[11px]",
  md: "gap-1.5 px-4 py-2 text-[12px]",
} as const;

export function FollowButton({
  traderId,
  initialFollowing,
  isMe,
  size = "sm",
  onChange,
}: {
  traderId: string;
  initialFollowing: boolean;
  isMe?: boolean;
  size?: keyof typeof SIZES;
  onChange?: (following: boolean) => void;
}) {
  const toggle = useToggleFollow("user");
  const [following, setFollowing] = useState(initialFollowing);
  const [err, setErr] = useState<string | null>(null);

  if (isMe) {
    return (
      <span className={`rounded-full border border-line px-2.5 py-1 text-[11px] font-bold text-muted ${SIZES[size]}`}>
        you
      </span>
    );
  }

  return (
    <button
      onClick={() =>
        void toggle(
          traderId,
          following,
          (next) => {
            setFollowing(next);
            onChange?.(next);
          },
          setErr,
        )
      }
      title={err ?? (following ? "Unfollow" : "Follow")}
      className={`press flex shrink-0 items-center rounded-full font-black ${
        SIZES[size]
      } ${
        following
          ? "border border-line bg-panel2 text-ink"
          : "border border-transparent burn-gradient text-black"
      }`}
    >
      {following ? (
        <>
          <UserCheckIcon key="on" className="star-pop h-3.5 w-3.5" />
          Following
        </>
      ) : (
        <>
          <UserPlusIcon className="h-3.5 w-3.5" />
          Follow
        </>
      )}
    </button>
  );
}

export function TokenFollowButton({
  mint,
  initialFollowing,
  size = "sm",
  onChange,
}: {
  mint: string;
  initialFollowing: boolean;
  size?: keyof typeof SIZES;
  onChange?: (following: boolean) => void;
}) {
  const toggle = useToggleFollow("token");
  const [following, setFollowing] = useState(initialFollowing);
  const [err, setErr] = useState<string | null>(null);

  return (
    <button
      onClick={() =>
        void toggle(
          mint,
          following,
          (next) => {
            setFollowing(next);
            onChange?.(next);
          },
          setErr,
        )
      }
      aria-label={following ? "Unfollow this token" : "Follow this token"}
      title={err ?? (following ? "Unfollow token" : "Follow token — its clips show in your Following feed")}
      className={`press flex shrink-0 items-center gap-1.5 rounded-full font-black ${
        SIZES[size]
      } ${
        following
          ? "border border-line bg-panel2 text-ink"
          : "border border-transparent burn-gradient text-black"
      }`}
    >
      {following ? (
        <>
          <UserCheckIcon key="on" className="star-pop h-3.5 w-3.5" />
          Following
        </>
      ) : (
        <>
          <UserPlusIcon className="h-3.5 w-3.5" />
          Follow
        </>
      )}
    </button>
  );
}
