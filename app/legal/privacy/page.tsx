import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, Section } from "@/components/LegalShell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Privacy Policy — ${LEGAL.product}`,
  description: `What ${LEGAL.product} collects, why, and what it never touches.`,
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro={`This explains what ${LEGAL.product} collects, why we need it, who else sees it, and what we deliberately never touch. The short version: we hold no private keys, we never take custody of your assets, and blockchain transactions are public by nature.`}
    >
      <Section title="1. Who we are">
        <p>
          {LEGAL.entity} operates {LEGAL.product}. For privacy questions or requests, contact{" "}
          {LEGAL.contactEmail}.
        </p>
      </Section>

      <Section title="2. What we collect">
        <p>Depending on how you use the Service, we hold:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-ink">Account identity.</strong> If you sign in, we store a
            pseudonymous account identifier from our wallet provider, the login method you used
            (email, Google, or X), and your email address when you sign in with email. We do not
            receive or store your Google or X password.
          </li>
          <li>
            <strong className="text-ink">Wallet address.</strong> The public address of the Solana
            wallet created for you or linked by you. A public address is, by itself, publicly
            visible on the blockchain.
          </li>
          <li>
            <strong className="text-ink">Activity.</strong> Practice balances, positions, and your
            trade history inside the Service, plus the transaction signatures of any live trades we
            record. Signature and transaction data is public on-chain.
          </li>
          <li>
            <strong className="text-ink">Technical data.</strong> Your IP address and basic request
            metadata, processed transiently for rate limiting and abuse prevention, plus error logs.
          </li>
          <li>
            <strong className="text-ink">A session cookie.</strong> If you use practice mode without
            signing in, a first-party cookie holds a random anonymous identifier so your practice
            balance persists. See section 5.
          </li>
        </ul>
      </Section>

      <Section title="3. What we never collect">
        <p>
          <strong className="text-ink">
            We never receive, store, transmit, or have the ability to derive your private key or
            recovery material.
          </strong>{" "}
          Wallet creation and signing happen inside our wallet provider&apos;s isolated environment.
          Our servers construct unsigned transactions and receive back only a public key and a
          signature. We cannot access, move, or freeze your funds.
        </p>
        <p>
          We also do not collect your name, postal address, government identifiers, or payment card
          details. If you buy crypto with a card, that is handled entirely by the wallet
          provider&apos;s payment partner; card data never reaches us.
        </p>
      </Section>

      <Section title="4. How we use it">
        <ul className="list-disc space-y-1 pl-5">
          <li>to create and secure your account and wallet, and keep you signed in;</li>
          <li>to operate practice mode and record the trades you make;</li>
          <li>to build the unsigned transactions you ask for, and verify on-chain that they settled;</li>
          <li>to show balances, positions, and market context;</li>
          <li>to rate limit, prevent abuse, and debug failures;</li>
          <li>to comply with legal obligations we are actually subject to.</li>
        </ul>
        <p>
          We do not sell your personal data, and we do not use it for advertising or behavioural
          profiling.
        </p>
      </Section>

      <Section title="5. Cookies and local storage">
        <p>
          We use a first-party cookie only to keep you signed in / keep your practice account
          attached. It is not used for tracking or advertising. Blocking it will break practice mode
          persistence and sign-in. Signing out clears the session server-side.
        </p>
        <p>
          Your wallet provider sets its own storage inside their sandboxed window. Their handling of
          it is governed by their privacy policy, not this one.
        </p>
      </Section>

      <Section title="6. Who else processes your data">
        <p>We use a small number of processors to run the Service:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-ink">Wallet &amp; authentication provider</strong> — creates
            your embedded wallet, holds key material we cannot access, and handles sign-in.
          </li>
          <li>
            <strong className="text-ink">Hosting &amp; database providers</strong> — serve the app
            and store the account and activity records described above.
          </li>
          <li>
            <strong className="text-ink">Swap routing and liquidity venues</strong> — receive the
            public details needed to build your swap (your public key, the mint, and the amount).
          </li>
          <li>
            <strong className="text-ink">Blockchain RPC and market-data providers</strong> —
            receive public addresses and mints to read balances, prices, and transaction status.
          </li>
        </ul>
        <p>
          These providers may process data outside your country. Where required, transfers rely on
          appropriate safeguards such as standard contractual clauses.
        </p>
      </Section>

      <Section title="7. On-chain data is public">
        <p>
          Solana is a public, permanent ledger. Any transaction you sign — including its amount,
          counterparties, and the fact that it came from your address — is visible to anyone,
          forever, and cannot be deleted by us or anyone else. Treat your wallet address as public
          information and do not link it to your real-world identity unless you intend that.
        </p>
      </Section>

      <Section title="8. Retention">
        <p>
          We keep account and activity records for as long as your account exists, and afterwards
          only as long as needed for the purposes above, to resolve disputes, or to meet legal
          obligations. Rate-limiting and error data is short-lived and rotates on a rolling basis.
          On-chain records are outside our control and cannot be deleted.
        </p>
      </Section>

      <Section title="9. Your rights">
        <p>
          Subject to your jurisdiction, you may have the right to access, correct, export, or delete
          your personal data, to object to or restrict certain processing, and to complain to your
          local data protection authority.
        </p>
        <p>
          Email {LEGAL.contactEmail} to make a request. Note the limit of what we can do: we cannot
          delete on-chain history, and where we never held your key, we cannot alter anything
          recorded on the blockchain.
        </p>
      </Section>

      <Section title="10. Security">
        <p>
          We protect what we hold with encryption in transit, restricted access, and scoped
          credentials. Authentication tokens from our wallet provider are verified server-side
          before any write. No system is perfectly secure, so use a strong, unique login method and
          keep your device up to date.
        </p>
      </Section>

      <Section title="11. Children">
        <p>
          The Service is not for anyone under {LEGAL.minimumAge}. We do not knowingly collect data
          from children. If you believe a child has used the Service, contact us and we will delete
          the account.
        </p>
      </Section>

      <Section title="12. Changes">
        <p>
          We may update this policy. The &ldquo;last updated&rdquo; date above always reflects the
          current version. Material changes will be made clear in the Service.
        </p>
      </Section>

      <Section title="13. Contact">
        <p>
          Privacy questions and requests:{" "}
          <strong className="text-ink">{LEGAL.contactEmail}</strong>.
        </p>
        <p>
          See also our{" "}
          <Link href="/legal/terms" className="text-ink underline">
            Terms of Service
          </Link>
          .
        </p>
      </Section>
    </LegalShell>
  );
}
