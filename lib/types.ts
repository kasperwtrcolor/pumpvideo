/** Shapes returned by the API routes. Kept in one place so client + server agree. */

export type CoinDTO = {
  mint: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  priceSol: number;
  marketCapSol: number;
  change24hPct: number;
  holders: number;
  volume24hSol: number;
  complete: boolean;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  launchedAt: string | null;
  virtualSol: string;
  virtualToken: string;
  totalSupply: string;
  buyPresetsSol: number[];
  sellPresetsPct: number[];
  clipCount?: number;
};

export type ClipDTO = {
  id: string;
  source: string;
  videoUrl: string;
  thumbUrl: string | null;
  caption: string | null;
  author: string | null;
  likes: number;
  shares: number;
  comments: number;
  views: number;
};

export type FeedItemDTO = ClipDTO & { coin: CoinDTO };

export type FeedResponse = {
  items: FeedItemDTO[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  solUsd: number;
};

export type PositionDTO = {
  mint: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  clip: string | null;
  tokens: number;
  costSol: number;
  priceSol: number;
  marketCapSol: number;
  complete: boolean;
  valueSol: number;
  pnlSol: number;
  pnlPct: number;
};

export type AccountResponse = {
  equity: number;
  cashSol: number;
  holdingsValue: number;
  costBasis: number;
  realizedSol: number;
  pnlSol: number;
  pnlPct: number;
  positions: PositionDTO[];
  trades: {
    id: string;
    side: string;
    symbol: string;
    mode: string;
    solAmount: number;
    priceSol: number;
    at: string;
  }[];
};
