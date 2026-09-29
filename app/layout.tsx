import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { TraderProvider } from "@/components/TraderProvider";
import { PrivyRoot } from "@/components/PrivyRoot";
import { PrivySessionSync } from "@/components/PrivySessionSync";
import { solUsd } from "@/lib/sol-price";

export const metadata: Metadata = {
  title: "PumpClip — every clip is a coin you can buy",
  description:
    "Swipe short clips. Every clip has its own coin you can buy — practice with play money first, no wallet needed.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#08080A",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const usd = await solUsd();

  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-bg text-ink">
        {/* PrivyRoot is outermost so its context is available to everything
            below; it renders children unwrapped when no app id is configured. */}
        <PrivyRoot>
          <TraderProvider initialSolUsd={usd}>
            <PrivySessionSync />
            <div className="mx-auto flex h-dvh w-full max-w-[440px] flex-col border-x border-line bg-bg">
              <TopNav />
              <div className="min-h-0 flex-1">{children}</div>
            </div>
          </TraderProvider>
        </PrivyRoot>
      </body>
    </html>
  );
}