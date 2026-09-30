import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { TraderProvider } from "@/components/TraderProvider";
import { PrivyRoot } from "@/components/PrivyRoot";
import { AuthBridge } from "@/components/AuthBridge";
import { PrivySessionSync } from "@/components/PrivySessionSync";
import { solUsd } from "@/lib/sol-price";

export const metadata: Metadata = {
  title: "Pogo — every clip is a coin you can buy",
  description:
    "Swipe short clips. Every clip has its own coin you can buy — real on-chain Solana trading from a wallet you control.",
  manifest: "/manifest.webmanifest",
  applicationName: "Pogo",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Pogo",
    description: "Swipe short clips. Every clip is a coin you can buy.",
    images: ["/og-icon.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Lets env(safe-area-inset-*) report real values on iOS, so the bottom bar
  // clears the home indicator and the header clears the notch.
  viewportFit: "cover",
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
          <AuthBridge>
            <TraderProvider initialSolUsd={usd}>
              <PrivySessionSync />
              {/* `relative` anchors AppHeader's overlay mode on the feed, where
                  it takes no layout space so the video runs to the top edge. */}
              <div className="relative mx-auto flex h-dvh w-full max-w-[440px] flex-col border-x border-line bg-bg">
                <AppHeader />
                <div className="min-h-0 flex-1">{children}</div>
                <BottomNav />
              </div>
            </TraderProvider>
          </AuthBridge>
        </PrivyRoot>
      </body>
    </html>
  );
}