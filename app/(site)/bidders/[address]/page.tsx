import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { StatusTag } from "@/components/Round";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getBidder } from "@/lib/cachet";
import { explorerAddress, HAS_EXPLORER } from "@/lib/chain";
import { formatDate, formatGen, shortAddress } from "@/lib/format";
import type { BidderRecord } from "@/lib/types";

export const revalidate = 30;

type Props = { params: { address: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: `Bidder ${shortAddress(params.address)}`,
    description: "What this address has entered, opened and scored, across every tender.",
  };
}

/**
 * A bidder's record.
 *
 * The other half of `/buyers/[address]`, and the half a buyer would most like
 * to read. Nothing here is new information - every figure comes from bids that
 * were revealed and scored in the open - but it was spread across every round
 * the address ever entered, which is to say it was not readable at all.
 *
 * Two numbers are deliberately kept apart. `expired` counts commitments that
 * were never opened, which is the one failure that costs a buyer a decision
 * they were waiting to make. `withdrawn` counts bids pulled while the window
 * was still filling, which costs nobody anything. A single "did not finish"
 * figure would merge the discourteous with the merely undecided.
 */
export default async function BidderPage({ params }: Props) {
  const address = decodeURIComponent(params.address);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) notFound();

  const record = await getBidder(address);
  const now = Date.now();

  return (
    <>
      {!CONFIGURED ? <NotConfigured /> : null}
      {CONFIGURED && !record ? <Unreachable what="this bidder's record" /> : null}

      <section className="on-ink section-tight">
        <div className="shell">
          <div className="breadcrumb">Bidder</div>
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
            <Stat label="Tenders entered" value={record ? String(record.entered) : " - "} />
            <Stat label="Won" value={record ? String(record.won) : " - "} note={<WinRate r={record} />} />
            <Stat
              label="Average score"
              value={<Average record={record} />}
            />
            <Stat
              label="Won to date"
              value={record ? formatGen(record.won_value) : " - "}
              unit={record ? "GEN" : ""}
            />
          </div>
        </div>
      </section>

      {/* The reliability row. Separated from the headline figures above because
          it answers a different question: not how good this bidder is, but
          whether they turn up. */}
      <section className="section-tight on-cream">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">Following through</div>
            <div className="eyebrow-note">every commitment this address has made</div>
          </div>
          <div className="grid grid-auto-160">
            <Stat label="Commitments made" value={record ? String(record.made) : " - "} dark={false} />
            <Stat label="Opened on time" value={record ? String(record.revealed) : " - "} dark={false} />
            <Stat label="Scored" value={record ? String(record.scored) : " - "} dark={false} />
            <Stat
              label="Never opened"
              value={record ? String(record.expired) : " - "}
              dark={false}
              note={
                record && record.expired > 0 ? (
                  <span className="stat-note">deposit forfeited</span>
                ) : null
              }
            />
            <Stat
              label="Withdrawn"
              value={record ? String(record.withdrawn) : " - "}
              dark={false}
              note={<span className="stat-note">before the deadline</span>}
            />
            <Stat label="Still sealed" value={record ? String(record.sealed) : " - "} dark={false} />
          </div>
          <p className="help" style={{ maxWidth: "72ch", marginTop: 14 }}>
            <strong>Never opened</strong> and <strong>withdrawn</strong> are counted separately on
            purpose. Both end a bid without a score, but a withdrawal happens in the open while the
            window is still taking bids and frees the slot for someone else, while a commitment
            that is never opened leaves a buyer waiting on a document that never arrives. Only the
            second forfeits the deposit.
          </p>
        </div>
      </section>

      <section className="section-tight on-cream">
        <div className="shell">
          {!record || record.entered === 0 ? (
            <div className="empty">
              {/* "Has never bid" is a claim. Only make it when the contract answered. */}
              {!CONFIGURED ? (
                <p>No contract is configured for this network, so there is no record to read.</p>
              ) : !record ? (
                <p>
                  This bidder&rsquo;s record could not be read, so this is not a claim that they
                  have never bid.
                  <br />
                  <Link href={`/bidders/${address}`}>Try again.</Link>
                </p>
              ) : (
                <p>
                  This address has never entered a tender.
                  <br />
                  <Link href="/rounds">Browse the docket</Link> instead.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="eyebrow-row">
                <div className="eyebrow">Tenders</div>
                <div className="eyebrow-note">
                  {record.showing < record.entered
                    ? `newest ${record.showing} of ${record.entered}`
                    : "newest first"}
                </div>
              </div>
              <div className="stack-tight">
                {record.rounds.map((r) => (
                  <EnteredRound key={r.id} round={r} now={now} />
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  unit,
  note,
  dark = true,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  note?: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className="stat" style={dark ? { borderColor: "var(--ink-line)" } : undefined}>
      <div className="label">{label}</div>
      <div className="stat-value">
        {value} {unit ? <small>{unit}</small> : null}
      </div>
      {note}
    </div>
  );
}

function WinRate({ r }: { r: BidderRecord | null }) {
  // A rate over scored bids, not over commitments: a bid that was never scored
  // was never in the running, and counting it would flatter or punish nobody
  // consistently.
  if (!r || r.scored === 0) return null;
  return <span className="stat-note">{Math.round((r.won / r.scored) * 100)}% of scored bids</span>;
}

function Average({ record }: { record: BidderRecord | null }) {
  if (!record) return <>{" - "}</>;
  if (record.points_max === 0) return <>{" - "}</>;
  // Rounded once, here, from the summed pair. Averaging per-round percentages
  // would weight a one-criterion round the same as a five-criterion one.
  return (
    <>
      {Math.round((record.points / record.points_max) * 100)}
      <small>%</small>
    </>
  );
}

/** One tender this address entered, with their own row picked out of it. */
function EnteredRound({
  round,
  now,
}: {
  round: BidderRecord["rounds"][number];
  now: number;
}) {
  const mine = round.mine;
  return (
    <Link href={`/r/${round.id}`} className="entered-row">
      <div className="entered-head">
        <span className="docket-id">R{round.id}</span>
        <span className="entered-title">{round.title}</span>
        <StatusTag round={round} now={now} />
      </div>
      <div className="entered-meta">
        <span>{formatGen(round.budget)} GEN</span>
        <span>PUBLISHED {formatDate(round.published_at).toUpperCase()}</span>
        {mine ? <span>YOUR BID {mine.i + 1}</span> : null}
        {mine ? <span>{mine.status.toUpperCase()}</span> : null}
        {mine && mine.status === "scored" ? (
          <span>
            SCORED {mine.total} OF {mine.max_total}
          </span>
        ) : null}
        {mine?.won ? <span className="entered-won">AWARDED</span> : null}
        {mine && mine.amendments > 0 ? (
          <span>
            AMENDED {mine.amendments} TIME{mine.amendments === 1 ? "" : "S"}
          </span>
        ) : null}
        {mine && mine.rescored ? <span>RE-SCORED ON APPEAL</span> : null}
      </div>
    </Link>
  );
}
