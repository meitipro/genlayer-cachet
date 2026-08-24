import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { RoundCard } from "@/components/Round";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getBuyer } from "@/lib/cachet";
import { explorerAddress, HAS_EXPLORER } from "@/lib/chain";
import { formatGen, shortAddress } from "@/lib/format";

export const revalidate = 30;

type Props = { params: { address: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: `Buyer ${shortAddress(params.address)}`,
    description: "Rounds run, awarded, declined, and average bids per round.",
  };
}

/**
 * A buyer's record.
 *
 * The declined column is the point of this page. A buyer who publishes ten
 * tenders and awards two has told bidders something worth knowing, and a
 * scoring history that only showed successes would be exactly as useful as the
 * procurement processes this product exists to replace.
 */
export default async function BuyerPage({ params }: Props) {
  const address = decodeURIComponent(params.address);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) notFound();

  const record = await getBuyer(address);
  const now = Date.now();
  const avgBids = record?.run ? (record.bids / record.run).toFixed(1) : " - ";
  const awardRate =
    record && record.awarded + record.declined
      ? Math.round((record.awarded / (record.awarded + record.declined)) * 100)
      : null;

  return (
    <>
      {!CONFIGURED ? <NotConfigured /> : null}
      {CONFIGURED && !record ? <Unreachable what="this buyer's record" /> : null}

      <section className="on-ink section-tight">
        <div className="shell">
          <div className="breadcrumb">Buyer</div>
          <h1
            style={{
              fontWeight: 800,
              fontSize: "clamp(24px,3vw,34px)",
              lineHeight: 1.1,
              letterSpacing: "-.03em",
              margin: "0 0 10px",
              fontFamily: "var(--mono)",
              wordBreak: "break-all",
            }}
          >
            {shortAddress(address, 6)}
          </h1>
          <p className="hash" style={{ color: "var(--on-ink-dim)", fontSize: 12.5 }}>
            {HAS_EXPLORER ? (
              <a href={explorerAddress(address)} target="_blank" rel="noreferrer noopener">
                {address}
              </a>
            ) : (
              address
            )}
          </p>

          <div className="grid grid-auto-160" style={{ marginTop: 28, borderColor: "var(--ink-line)" }}>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Rounds run</div>
              <div className="stat-value">{record ? record.run : " - "}</div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Awarded</div>
              <div className="stat-value">
                {record ? record.awarded : " - "}
                {awardRate !== null ? <small> {awardRate}%</small> : null}
              </div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Declined</div>
              <div className="stat-value">{record ? record.declined : " - "}</div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Average bids per round</div>
              <div className="stat-value">{avgBids}</div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Escrowed to date</div>
              <div className="stat-value">
                {record ? formatGen(record.escrowed) : " - "} {record ? <small>GEN</small> : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight on-cream">
        <div className="shell">
          {!record || record.run === 0 ? (
            <div className="empty">
              {/* Only say "never published" when the contract actually answered. */}
              {!CONFIGURED ? (
                <p>No contract is configured for this network, so there is no record to read.</p>
              ) : !record ? (
                <p>
                  This buyer&rsquo;s record could not be read, so this is not a claim that they
                  have never published.
                  <br />
                  <Link href={`/buyers/${address}`}>Try again.</Link>
                </p>
              ) : (
                <p>
                  This address has never published a tender.
                  <br />
                  <Link href="/rounds">Browse the docket</Link> instead.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="eyebrow-row">
                <div className="eyebrow">Rounds</div>
                <div className="eyebrow-note">
                  {record.showing < record.run
                    ? `newest ${record.showing} of ${record.run}`
                    : "newest first"}
                </div>
              </div>
              <div className="grid grid-auto-290">
                {record.rounds.map((r) => (
                  <RoundCard key={r.id} round={r} now={now} />
                ))}
              </div>

              <div className="note" style={{ marginTop: 26 }}>
                <strong>What this record is for.</strong> Criteria and scores are archived per
                round, so drift in how a buyer writes a standard is visible across their history -
                and a bidder deciding whether a tender is worth a day of writing can see how often
                this buyer actually awards.
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
