/**
 * Legal entity details, in one place.
 *
 * These values feed the Terms and Privacy pages *and* should match what you set
 * in the Privy dashboard (App settings → legal name, terms URL, privacy URL).
 *
 * ⚠️ Before you take real money, fill in the placeholders below. They are
 * deliberately obvious so nothing ships half-filled by accident. These documents
 * are a solid starting template, not legal advice — have a lawyer review them.
 */

export const LEGAL = {
  /** Trading name shown throughout the app. */
  product: "Pemp",
  /**
   * The legal entity that operates the app. Replace with your registered
   * company, or your own name if you're operating as an individual.
   */
  entity: "[LEGAL ENTITY NAME — e.g. Pemp Ltd, or your full legal name]",
  /** Where the entity is registered — governs which law applies. */
  jurisdiction: "[JURISDICTION — e.g. England and Wales]",
  /** A monitored inbox. Required by both Apple and Google for app review too. */
  contactEmail: "[CONTACT EMAIL — e.g. legal@pemp.fun]",
  /** Shown as "Last updated" on both documents. */
  lastUpdated: "29 September 2026",
  /** Minimum age. 18 matches most jurisdictions' treatment of speculative trading. */
  minimumAge: 18,
} as const;

export type LegalDoc = "terms" | "privacy";

export const LEGAL_LINKS: { doc: LegalDoc; href: string; label: string }[] = [
  { doc: "terms", href: "/legal/terms", label: "Terms of Service" },
  { doc: "privacy", href: "/legal/privacy", label: "Privacy Policy" },
];
