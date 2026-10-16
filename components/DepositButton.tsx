"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthBridge";
import { setAccountView } from "@/lib/account-view";

/**
 * The header's money button: Deposit when signed in, Login when not.
 *
 * One control rather than two, because it is the same decision from the user's
 * side — "put money in" — and the only difference is whether we already know
 * where to put it. Keeping it in the top-right corner, where every wallet app
 * puts it, means it never has to be hunted for.
 *
 * Signed in, it opens the Receive panel: the QR code and the copy-address
 * button. That is what "deposit" means to anyone holding a wallet — they want
 * the address to send to. (There is no card top-up: the user brings their own
 * wallet, so funding it is their wallet's job, not ours.)
 */
export function DepositButton({ overlay }: { overlay?: boolean }) {
  return <DepositButtonInner overlay={overlay} />;
}

function DepositButtonInner({ overlay }: { overlay?: boolean }) {
  // Through `useAuth`, so a desktop click raises the mobile gate instead of a
  // wallet modal. Every sign-in affordance has to funnel through the one place
  // that knows about desktop.
  const { authenticated, login } = useAuth();
  const router = useRouter();

  const onClick = useCallback(() => {
    if (!authenticated) {
      login();
      return;
    }
    setAccountView("receive");
    router.push("/account");
  }, [authenticated, login, router]);

  return (
    <button
      onClick={onClick}
      aria-label={authenticated ? "Deposit funds — show your address" : "Login"}
      className={`press shrink-0 rounded-full bg-white px-3.5 py-2 text-[13px] font-black tracking-tight text-black ${
        overlay ? "shadow-[0_4px_16px_rgba(0,0,0,0.45)]" : ""
      }`}
    >
      {authenticated ? "Deposit" : "Login"}
    </button>
  );
}
