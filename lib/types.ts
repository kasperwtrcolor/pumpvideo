/** Shapes returned by the API routes. Kept in one place so client + server agree. */

export type CoinDTO = {
  mint: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  priceSol: number;
  marketCapSol: number;
  change24hPct: number;
  /** Net price move over the trailing ~5 minutes, in percent (signed). */
  change5mPct: number;
  /** Unsigned recent volatility. Kept as a regime signal; no rail ranks on it. */
  volatility5m: number;
  holders: number;
  volume24hSol: number;
  complete: boolean;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  /** The counterparty this coin is quoted against; null for a SOL pair. */
  quoteSymbol: string | null;
  quoteName: string | null;
  quoteIconUrl: string | null;
  /** pump.fun launch time, when the source gave us one. */
  launchedAt: string | null;
  /** When the coin entered our catalogue — the age fallback when `launchedAt` is null. */
  createdAt: string;
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
  /** The uploading trader, for tapping through to their profile. Null when seeded. */
  creatorId?: string | null;
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

export type FeedItemDTO = ClipDTO & {
  coin: CoinDTO;
  /**
   * The caller's holding in this coin, or null when they own none. Lets the
   * feed colour a clip against the viewer's own entry price instead of a
   * generic 24h change.
   */
  position?: PositionLite | null;
};

/**
 * A live quote for one coin, as returned by /api/quotes.
 *
 * `live` distinguishes a DexScreener price from the market keeper's last write:
 * the two look identical but only one is genuinely second-by-second, and the
 * ticker is honest about which it is showing.
 */
export type QuoteDTO = {
  priceSol: number;
  marketCapSol: number;
  change24hPct: number;
  live: boolean;
};

export type QuotesResponse = { quotes: Record<string, QuoteDTO> };

/**
 * A public account as every social surface renders it: search results, follower
 * lists, profile headers. `slug` is what goes in a profile URL — a username when
 * one is claimed, the row id otherwise. It is never `handle`, which is the
 * session cookie value and must not be published.
 */
export type UserCardDTO = {
  id: string;
  slug: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followers: number;
  following: number;
  isFollowing: boolean;
  isMe: boolean;
};

/** A token hit from search. */
export type TokenHitDTO = {
  mint: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceSol: number;
  marketCapSol: number;
  change24hPct: number;
  complete: boolean;
  /** The pair this token is quoted against; null for a SOL pair. */
  quoteSymbol: string | null;
  quoteName: string | null;
  quoteIconUrl: string | null;
  isFollowing: boolean;
};

export type SearchResponse = { users: UserCardDTO[]; tokens: TokenHitDTO[] };

export type ProfileResponse = { user: UserCardDTO; clips: FeedItemDTO[]; total: number };

/**
 * One inbox row. `actor` is null when the account that caused it has since been
 * deleted — the notification survives, the name attached to it does not.
 */
export type NotificationDTO = {
  id: string;
  type: "FOLLOW" | "UPLOAD" | "TOKEN_CLIP";
  read: boolean;
  at: string;
  actor: { slug: string; name: string; avatarUrl: string | null } | null;
  coinSymbol: string | null;
  coinImage: string | null;
  clipId: string | null;
  clipThumb: string | null;
  coinMint: string | null;
};

export type NotificationsResponse = { unread: number; notifications: NotificationDTO[] };

/** The caller's position in a coin, sized at the current price. */
export type PositionLite = {
  tokens: number;
  costSol: number;
  /** SOL per whole token at the moment it was bought — the green/red line. */
  entrySol: number;
  valueSol: number;
  pnlSol: number;
  pnlPct: number;
};

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
  /** Lifetime creator rewards in SOL — the 1% paid on buys through this trader's clips. */
  rewardsSol: number;
  /** Number of buys that have paid this trader, and how many coins they came from. */
  rewardsBuys: number;
  rewardsCoins: number;
  /** Per-coin breakdown of rewards earned, largest first. */
  rewards: { mint: string; symbol: string; sol: number }[];
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
