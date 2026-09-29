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
  /** Null until the clip has been rendered — the feed then shows the coin art. */
  videoUrl: string | null;
  thumbUrl: string | null;
  caption: string | null;
  author: string | null;
  /** Wallet that earns the 1% creator fee on buys through this clip. */
  creatorWallet: string | null;
  likes: number;
  shares: number;
  comments: number;
  views: number;
  /** True when the requesting trader has liked this clip. */
  likedByMe?: boolean;
  /** True when the requesting trader has saved this clip to favourites. */
  favoritedByMe?: boolean;
};

export type FeedItemDTO = ClipDTO & { coin: CoinDTO };

export type FeedResponse = {
  items: FeedItemDTO[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  solUsd: number;
};

/**
 * GET /api/favorites — the caller's saved clips, newest save first.
 *
 * Shaped like a feed page so the same card component can render both, but
 * paginated by the favourite's own `createdAt` rather than a feed rank: the
 * order here is "what I saved, most recent first", which has nothing to do with
 * how popular the coin is.
 */
export type FavoritesResponse = {
  items: FeedItemDTO[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  solUsd: number;
};

export type CommentDTO = {
  id: string;
  body: string;
  author: string;
  avatarUrl: string | null;
  mine: boolean;
  at: string;
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
  walletAddress: string | null;
  /** Live on-chain SOL balance, or null when it could not be read. */
  walletSol: number | null;
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
    txSig: string | null;
    at: string;
  }[];
};
