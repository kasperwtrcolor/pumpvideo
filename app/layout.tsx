import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Shell } from "@/components/Shell";
import { InstallBridge } from "@/components/InstallBridge";
import { TraderProvider } from "@/components/TraderProvider";
import { WalletRoot } from "@/components/WalletRoot";
import { AuthBridge } from "@/components/AuthBridge";
import { SiwsSession } from "@/components/SiwsSession";
import { solUsd } from "@/lib/sol-price";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://www.pemp.fun"),
  title: "Pemp — every clip is a coin you can buy",
  description:
    "Swipe short clips. Every clip has its own coin you can buy — real on-chain Solana trading from a wallet you control.",
  manifest: "/manifest.webmanifest",
  applicationName: "Pemp",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  // The share card itself comes from the file convention (app/opengraph-image.png
  // and app/twitter-image.png), so the absolute URL is built from metadataBase.
  openGraph: {
    title: "Pemp — every clip is a coin you can buy",
    description:
      "Swipe short clips. Every clip is a coin you can buy — real on-chain Solana trading from a wallet you control.",
    siteName: "Pemp",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    site: "@pempfun1",
    creator: "@pempfun1",
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
        {/* WalletRoot is outermost so its wallet context is available to
            everything below, including the SIWS handshake. */}
        <WalletRoot>
          <AuthBridge>
            {/* Parked in the layout, not in a screen: `beforeinstallprompt`
                fires once, early, and the install nudge may not be mounted yet
                when it does. Renders nothing. */}
            <InstallBridge />
            <TraderProvider initialSolUsd={usd}>
              <SiwsSession />
              {/* The frame is chosen by viewport in Shell: the phone chrome on a
                  narrow screen, the wide four-region shell on a desktop. `relative`
                  anchors AppHeader's overlay mode on the feed, where it takes no
                  layout space so the video runs to the top edge. */}
              <Shell>{children}</Shell>
            </TraderProvider>
          </AuthBridge>
        </WalletRoot>
      </body>
    </html>
  );
}