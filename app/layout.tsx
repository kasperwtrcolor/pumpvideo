import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { TraderProvider } from "@/components/TraderProvider";
import { PrivyRoot } from "@/components/PrivyRoot";
import { AuthBridge } from "@/components/AuthBridge";
import { PrivySessionSync } from "@/components/PrivySessionSync";
import { solUsd } from "@/lib/sol-price";

export const metadata: Metadata = {
  title: "PumpClip — every clip is a coin you can buy",
  description:
    "Swipe short clips. Every clip has its own coin you can buy — real on-chain Solana trading from a wallet you control.",
  manifest: "/manifest.webmanifest",
  applicationName: "PumpClip",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "PumpClip",
    description: "Swipe short clips. Every clip is a coin you can buy.",
    images: ["/og-icon.png"],
  },
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
          <AuthBridge>
            <TraderProvider initialSolUsd={usd}>
              <PrivySessionSync />
              <div className="mx-auto flex h-dvh w-full max-w-[440px] flex-col border-x border-line bg-bg">
                <TopNav />
                <div className="min-h-0 flex-1">{children}</div>
              </div>
            </TraderProvider>
          </AuthBridge>
        </PrivyRoot>
      </body>
    </html>
  );
}