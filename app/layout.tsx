import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { TraderProvider } from "@/components/TraderProvider";
import { solUsd } from "@/lib/sol-price";

export const metadata: Metadata = {
  title: "PUMPCLIP — every clip is a coin you can buy",
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
        <TraderProvider initialSolUsd={usd}>
          <div className="mx-auto flex h-dvh w-full max-w-[440px] flex-col border-x border-line bg-bg">
            <TopNav />
            <div className="min-h-0 flex-1">{children}</div>
          </div>
        </TraderProvider>
      </body>
    </html>
  );
}
