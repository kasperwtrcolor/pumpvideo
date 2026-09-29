import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, Section } from "@/components/LegalShell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Terms of Service — ${LEGAL.product}`,
  description: `The terms that govern your use of ${LEGAL.product}.`,
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro={`These Terms govern your use of ${LEGAL.product}. ${LEGAL.product} is a non-custodial interface to public liquidity on the Solana blockchain. We do not hold your funds, we do not hold your keys, and we do not buy or sell anything on your behalf. Read the risk section — tokens traded here can lose all their value.`}
    >
      <Section title="1. Agreement">
        <p>
          By accessing or using {LEGAL.product} (the &ldquo;Service&rdquo;) you agree to these Terms
          of Service. If you do not agree, do not use the Service. The Service is operated by{" "}
          {LEGAL.entity} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
        </p>
        <p>
          If you use the Service on behalf of an organisation, you represent that you have authority
          to bind that organisation to these Terms.
        </p>
      </Section>

      <Section title="2. Eligibility">
        <p>
          You must be at least {LEGAL.minimumAge} years old to use the Service, and of legal age to
          enter into a binding contract where you live. You must not use the Service if you are
          subject to sanctions, or if using it would breach any law that applies to you.
        </p>
        <p>
          You are responsible for determining whether trading digital assets is lawful in your
          jurisdiction, and for any tax that arises from your activity.
        </p>
      </Section>

      <Section title="3. What PumpClip is — and is not">
        <p>To be explicit, because it matters:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-ink">We are not a broker, exchange, or custodian.</strong> We
            never take possession of your assets. Your wallet is created and secured by a
            third-party wallet provider, and the private key is yours.
          </li>
          <li>
            <strong className="text-ink">We do not execute trades for you.</strong> When you place
            a trade, we construct an unsigned transaction. Your wallet signs it. The transaction is
            broadcast by you to the Solana network.
          </li>
          <li>
            <strong className="text-ink">We do not provide investment advice.</strong> Nothing on
            the Service is a recommendation to buy, sell, or hold anything. No content is tailored
            to your circumstances.
          </li>
          <li>
            <strong className="text-ink">We are not a party to your trades.</strong> Trades are
            executed against third-party liquidity pools and smart contracts that we do not control,
            and we cannot reverse them.
          </li>
        </ul>
        <p>
          Price, market capitalisation, holder and volume figures shown in the Service are
          estimates assembled from third-party sources. They can be delayed, incomplete, or wrong.
          Always verify against the blockchain before making a decision.
        </p>
      </Section>

      <Section title="4. Risk disclosure">
        <p>
          <strong className="text-ink">
            Trading the tokens surfaced by this Service can result in the total and irreversible
            loss of everything you put in.
          </strong>{" "}
          Specifically:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Memecoins and launchpad tokens are highly speculative. Most go to zero. There is no
            underlying business, cashflow, or asset backing them.
          </li>
          <li>
            They are extremely volatile and can move by large percentages within seconds, including
            while your transaction is in flight.
          </li>
          <li>
            Liquidity can be thin, or withdrawn. You may be unable to sell at any price, or at all.
          </li>
          <li>
            Smart contracts, bridges, and wallet software can contain bugs or be exploited. Funds
            sent to a wrong address are gone permanently.
          </li>
          <li>
            Blockchains are irreversible by design. No one — including us — can cancel, refund, or
            reverse a transaction.
          </li>
          <li>
            Nothing here is insured. There is no deposit protection, no compensation scheme, and no
            recourse against us for market losses.
          </li>
        </ul>
        <p>Only use funds you can afford to lose entirely.</p>
      </Section>

      <Section title="5. Your wallet and your keys">
        <p>
          Signing in creates a self-custodial Solana wallet through our third-party wallet provider.
          We never receive, store, or have the ability to derive your private key. We cannot move
          your funds, freeze your account, or recover your assets if you lose access.
        </p>
        <p>
          You are solely responsible for the security of your device, your login method, and any
          exported private key. If you export a key, anyone who sees it can take everything in the
          wallet, permanently. Keep it offline and never share it.
        </p>
        <p>
          You are also responsible for every transaction signed by your wallet, whether or not you
          initiated it, and for verifying destination addresses and amounts before signing.
        </p>
      </Section>

      <Section title="6. Practice mode">
        <p>
          The Service offers a practice mode using simulated balances. Practice balances are not
          real assets, have no value, cannot be withdrawn or transferred, and may be reset or
          adjusted at any time. Practice results are simulated against market data and are not a
          prediction of live results.
        </p>
      </Section>

      <Section title="7. Fees">
        <p>
          Live trades pay network fees charged by the Solana blockchain, plus any fee charged by the
          third-party liquidity venue and swap router used to fill your trade. These fees are shown
          to you before you sign. We may in future charge a service fee, which will be disclosed
          before you sign a transaction that includes it.
        </p>
      </Section>

      <Section title="8. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>use the Service unlawfully, or to launder money, evade sanctions, or fund illegal activity;</li>
          <li>manipulate, spoof, or wash trade, or attempt to distort prices or volume;</li>
          <li>interfere with the Service, probe or bypass its security or rate limits, or scrape it at scale;</li>
          <li>impersonate others, or misrepresent your affiliation with any person or project;</li>
          <li>infringe anyone&apos;s intellectual property, or upload content you do not have the right to use.</li>
        </ul>
        <p>
          We may suspend or block access to the Service at any time, including where we suspect
          abuse or a legal obligation to do so.
        </p>
      </Section>

      <Section title="9. Clips and third-party content">
        <p>
          Clips, images, names and symbols shown in the Service are sourced from third parties,
          including token issuers on public launchpads. They are displayed for identification
          purposes only. Their appearance is not an endorsement, a verification, or a statement that
          a token is legitimate or safe.
        </p>
        <p>
          If you believe content in the Service infringes your rights, contact{" "}
          {LEGAL.contactEmail} and we will review it.
        </p>
      </Section>

      <Section title="10. Third-party services">
        <p>
          The Service depends on third parties including Solana RPC providers, our wallet provider,
          and a third-party swap router/liquidity venue. Their terms and privacy practices apply to
          your use of them. We do not control them and are not responsible for their availability,
          performance, or conduct.
        </p>
      </Section>

      <Section title="11. Availability and changes">
        <p>
          The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We
          may change, suspend, or discontinue any part of it at any time, including features that
          you have come to rely on. We do not guarantee uptime, and the Service may be unavailable
          during network congestion or maintenance.
        </p>
        <p>
          We may update these Terms. Material changes will be reflected by the &ldquo;last
          updated&rdquo; date above. Continuing to use the Service after a change means you accept
          the updated Terms.
        </p>
      </Section>

      <Section title="12. Disclaimers">
        <p>
          To the maximum extent permitted by law, the Service is provided without warranties of any
          kind, express or implied, including merchantability, fitness for a particular purpose,
          title, accuracy, and non-infringement. We do not warrant that the Service will be
          uninterrupted, secure, or free of errors, or that any data shown is accurate or complete.
        </p>
        <p>
          Some jurisdictions do not allow the exclusion of certain warranties, so parts of this
          section may not apply to you.
        </p>
      </Section>

      <Section title="13. Limitation of liability">
        <p>
          To the maximum extent permitted by law, {LEGAL.entity} and its contributors will not be
          liable for any indirect, incidental, special, consequential, or punitive damages, or for
          any loss of profits, revenue, data, or digital assets, arising out of or relating to your
          use of the Service — including losses from trades, market movements, smart contract
          failures, wallet compromise, or network issues.
        </p>
        <p>
          Where liability cannot be excluded, our total aggregate liability to you is limited to the
          greater of (a) the service fees you paid us in the three months before the claim, or (b)
          USD 100.
        </p>
      </Section>

      <Section title="14. Indemnity">
        <p>
          You agree to indemnify and hold harmless {LEGAL.entity} from any claim, loss, liability,
          or expense (including reasonable legal fees) arising from your use of the Service, your
          breach of these Terms, or your violation of any law or third-party right.
        </p>
      </Section>

      <Section title="15. Governing law">
        <p>
          These Terms are governed by the laws of {LEGAL.jurisdiction}, without regard to
          conflict-of-law rules. The courts of {LEGAL.jurisdiction} have exclusive jurisdiction over
          any dispute arising from these Terms or the Service.
        </p>
      </Section>

      <Section title="16. Contact">
        <p>
          Questions about these Terms: <strong className="text-ink">{LEGAL.contactEmail}</strong>.
        </p>
        <p>
          See also our{" "}
          <Link href="/legal/privacy" className="text-ink underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>
    </LegalShell>
  );
}
