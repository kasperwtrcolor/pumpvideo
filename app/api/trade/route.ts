import type { NextRequest } from "next/server";
import { z } from "zod";
import { withTrader } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  executePracticeBuy,
  executePracticeSell,
  TradeError,
} from "@/lib/trade-engine";
import { resolveTrader } from "@/lib/session";

export const dynamic = "force-dynamic";

const BuySchema = z.object({
  mint: z.string().min(32).max(48),
  side: z.literal("BUY"),
  solAmount: z.number().positive().max(50),
  mode: z.enum(["PRACTICE", "LIVE"]).default("PRACTICE"),
});

const SellSchema = z.object({
  mint: z.string().min(32).max(48),
  side: z.literal("SELL"),
  fraction: z.number().positive().max(1),
  mode: z.enum(["PRACTICE", "LIVE"]).default("PRACTICE"),
});

const Body = z.discriminatedUnion("side", [BuySchema, SellSchema]);

/**
 * POST /api/trade
 *   { mint, side: "BUY",  solAmount: 0.5, mode: "PRACTICE" }
 *   { mint, side: "SELL", fraction: 1.0,   mode: "PRACTICE" }
 *
 * LIVE routes to executeLiveFill(), which currently throws a 501 — we never
 * fake a fill and never claim a tx signature we didn't get.
 */
export async function POST(req: NextRequest) {
  const { trader, created } = await resolveTrader();

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return withTrader(
      { error: "invalid body", detail: (e as Error).message },
      { status: 400, trader, created },
    );
  }

  if (parsed.mode === "LIVE") {
    // Live fills don't run through here. This endpoint writes practice rows
    // straight to the DB; a real fill has to be signed by the wallet and
    // verified on chain, which is what /api/trade/live/* exists for.
    return withTrader(
      {
        error: "USE_LIVE_ENDPOINTS",
        detail:
          "Live trades are built and verified through /api/trade/live/prepare then /api/trade/live/confirm.",
      },
      { status: 400, trader, created },
    );
  }

  try {
    // The resolved trader is a pre-trade snapshot — re-read it after the fill so
    // the client's balance chip is correct without a second round trip.
    const fresh = async () =>
      (await prisma.trader.findUniqueOrThrow({ where: { id: trader.id } }))!;

    if (parsed.side === "BUY") {
      const r = await executePracticeBuy({
        traderId: trader.id,
        mint: parsed.mint,
        solAmount: parsed.solAmount,
      });
      return withTrader(
        {
          ok: true,
          side: "BUY",
          symbol: r.trade.symbol,
          tokensOut: r.tokensOut,
          priceSol: r.priceSol,
          feeSol: r.feeSol,
          slippagePct: r.slippagePct,
        },
        { trader: await fresh(), created },
      );
    }

    const r = await executePracticeSell({
      traderId: trader.id,
      mint: parsed.mint,
      fraction: parsed.fraction,
    });
    return withTrader(
      {
        ok: true,
        side: "SELL",
        symbol: r.trade.symbol,
        tokensIn: r.tokensIn,
        solOut: r.solOut,
        priceSol: r.priceSol,
        slippagePct: r.slippagePct,
      },
      { trader: await fresh(), created },
    );
  } catch (e) {
    if (e instanceof TradeError) {
      const status = e.code === "INSUFFICIENT_FUNDS" ? 402 : 400;
      return withTrader({ error: e.code, detail: e.message }, { status, trader, created });
    }
    console.error("[trade]", e);
    return withTrader(
      { error: "INTERNAL", detail: "trade failed" },
      { status: 500, trader, created },
    );
  }
}
