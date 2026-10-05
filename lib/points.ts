/**
 * Pemp Points — one number that ranks a trader by what they have actually done.
 *
 * Why a single score rather than a raw sort on one column: the app pays people
 * for clips and lets them trade, so "who is doing well here" is not any one of
 * those. Points make the two comparable without pretending they are the same
 * thing, and every term is a fact already stored — nothing here is invented or
 * self-reported, so the board cannot be gamed by claiming something.
 *
 * Two families, deliberately weighted apart:
 *
 *   Creation  — clips posted, and the engagement those clips drew (likes,
 *               comments, shares, followers). This is what the product is for.
 *   Money     — trades placed, volume moved, and the creator cut actually earned
 *               on-chain. Earnings are weighted hard because they are the only
 *               term nobody can fake: the SOL moved.
 *
 * `perSolRewards` is the heaviest term on purpose. At 1000 points per SOL, a
 * creator earning 0.01 SOL scores the same as twenty clips — which is the
 * ordering the app wants to advertise: post clips that sell, and you win.
 *
 * Weights are one object so the whole economy is tunable in one place. No
 * invitation/referral term yet — when that ships it belongs here as another
 * line in `pointsFor`, not as a separate score.
 */
export const POINT_WEIGHTS = {
  clipPosted: 50,
  likeReceived: 2,
  commentReceived: 5,
  shareReceived: 8,
  follower: 10,
  trade: 5,
  /** Points per 1 SOL of trade volume. */
  perSolTraded: 10,
  /** Points per 1 SOL of creator rewards actually earned on-chain. */
  perSolRewards: 1000,
} as const;

export type PointStats = {
  clips: number;
  likes: number;
  comments: number;
  shares: number;
  followers: number;
  trades: number;
  volumeSol: number;
  rewardsSol: number;
};

/** One contributing term, kept so the UI can show *why* a score is what it is. */
export type PointLine = {
  key: keyof PointStats;
  label: string;
  count: number;
  each: number;
  points: number;
  /** How the count should be rendered (SOL amounts read differently to counts). */
  unit: "count" | "sol";
};

/**
 * The pure score. Kept pure and free of Prisma so the exact same function that
 * ranks the board is the one the UI explains, and so it can be unit-tested
 * without a database.
 */
export function pointsFor(s: PointStats): { total: number; lines: PointLine[] } {
  const W = POINT_WEIGHTS;
  const lines: PointLine[] = [
    { key: "clips", label: "clips posted", count: s.clips, each: W.clipPosted, points: s.clips * W.clipPosted, unit: "count" },
    { key: "likes", label: "likes received", count: s.likes, each: W.likeReceived, points: s.likes * W.likeReceived, unit: "count" },
    { key: "comments", label: "comments received", count: s.comments, each: W.commentReceived, points: s.comments * W.commentReceived, unit: "count" },
    { key: "shares", label: "shares received", count: s.shares, each: W.shareReceived, points: s.shares * W.shareReceived, unit: "count" },
    { key: "followers", label: "followers", count: s.followers, each: W.follower, points: s.followers * W.follower, unit: "count" },
    { key: "trades", label: "trades", count: s.trades, each: W.trade, points: s.trades * W.trade, unit: "count" },
    { key: "volumeSol", label: "SOL traded", count: s.volumeSol, each: W.perSolTraded, points: Math.round(s.volumeSol * W.perSolTraded), unit: "sol" },
    { key: "rewardsSol", label: "SOL earned by clips", count: s.rewardsSol, each: W.perSolRewards, points: Math.round(s.rewardsSol * W.perSolRewards), unit: "sol" },
  ];
  return { total: lines.reduce((sum, l) => sum + l.points, 0), lines };
}

/** The legend the leaderboard page renders, straight from the weights. */
export const POINT_LEGEND = [
  { label: "clip posted", value: `+${POINT_WEIGHTS.clipPosted}` },
  { label: "like received", value: `+${POINT_WEIGHTS.likeReceived}` },
  { label: "comment received", value: `+${POINT_WEIGHTS.commentReceived}` },
  { label: "share received", value: `+${POINT_WEIGHTS.shareReceived}` },
  { label: "follower", value: `+${POINT_WEIGHTS.follower}` },
  { label: "trade placed", value: `+${POINT_WEIGHTS.trade}` },
  { label: "SOL traded", value: `+${POINT_WEIGHTS.perSolTraded} / SOL` },
  { label: "SOL earned by clips", value: `+${POINT_WEIGHTS.perSolRewards} / SOL` },
] as const;
