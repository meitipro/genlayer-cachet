import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Scorecard } from "@/components/Round";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getBid, readRound } from "@/lib/cachet";
import { explorerAddress, HAS_EXPLORER } from "@/lib/chain";
import { formatDate, formatGen, maxTotal, scoredBids, shortAddress } from "@/lib/format";

export const revalidate = 15;

type Props = { params: { id: string; bid: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Deliberately does not read the chain: this title is derivable from the URL
  // alone, so it costs no request and can never claim something is missing.
  return { title: `Bid ${Number(params.bid) + 1} - round ${params.id}` };
}

/**
 * One bid, in full.
 *
 * The revealed proposal is public by construction: it was hash-committed
 * before anyone saw a score, and publishing it is what makes the scorecard
 * checkable by a reader rather than something they have to take on trust.
 */
function BidUnavailable({ id }: { id: number }) {
  return (
    <>
      {CONFIGURED ? <Unreachable what="this bid" /> : <NotConfigured />}
    <section className="section on-cream">
      <div className="shell">
        <div className="eyebrow-row">
          <div className="eyebrow">Round {id}</div>
          <div className="eyebrow-note">
            {CONFIGURED ? "could not read the chain" : "no contract configured"}
          </div>
        </div>
        <h1 className="display" style={{ maxWidth: "20ch" }}>
          This bid could not be read.
        </h1>
        {/* An unset address and a rate-limited read are not the same failure,
            and only one of them is fixed by trying again. */}
        <p className="lede">
          {CONFIGURED
            ? "The contract did not answer, so we do not know whether this bid exists. That is almost always the network’s rate limit rather than anything wrong with the bid."
            : "No contract is configured for this network, so there is no bid to read."}
        </p>
        <div className="btn-row">
          <Link href={`/r/${id}`} className="btn btn-primary">
            Back to the round
          </Link>
        </div>
      </div>
    </section>
    </>
  );
}

export default async function BidPage({ params }: Props) {
  const id = Number(params.id);
  const index = Number(params.bid);
  if (!Number.isInteger(id) || !Number.isInteger(index) || id < 0 || index < 0) notFound();

  const result = await readRound(id);
  // Same rule as the round page: only a contract that answered "no such round"
  // earns a 404. A read that never landed gets a retry, not a permanent claim.
  if (result.state === "absent") notFound();
  if (result.state === "unavailable") return <BidUnavailable id={id} />;

  // The round read landed but the BIDS read did not. We therefore do not know
  // whether this bid exists, and 404 would be the same false claim the guard
  // above refuses to make about the round.
  if (result.value.bids === null) return <BidUnavailable id={id} />;

  const listed = result.value.bids.find((b) => b.i === index);
  // The list truncates proposals at 400 characters; this view carries the whole
  // text. Only worth the extra request once there is something revealed to
  // read, and the page still renders off the listed copy if it does not land.
  const full = listed && listed.proposal ? await getBid(id, index) : null;
  const bid = full ?? listed;
  // True when we are showing the 400-character copy under a heading that gives
  // the full length. The heading has to say so rather than let the reader
  // assume the text ended where it stopped.
  const truncated =
    bid !== undefined && full === null && bid.proposal.length < bid.proposal_length;
  if (!bid) notFound();

  const { round } = result.value;
  const bids = result.value.bids;
  const ranked = scoredBids(bids);
  const winner = ranked[0] ?? null;
  const isWinner = winner?.i === bid.i;

  return (
    <>
      <section className="on-ink section-tight">
        <div className="shell">
          <div className="breadcrumb">
            <Link href="/rounds" style={{ color: "var(--on-ink-dim)" }}>
              THE DOCKET
            </Link>{" "}
            /{" "}
            <Link href={`/r/${round.id}`} style={{ color: "var(--on-ink-dim)" }}>
              ROUND {round.id}
            </Link>{" "}
            / BID {bid.i + 1}
          </div>
          <h1
            style={{
              fontWeight: 800,
              fontSize: "clamp(26px,3.2vw,38px)",
              lineHeight: 1.05,
              letterSpacing: "-.03em",
              margin: "0 0 12px",
            }}
          >
            {isWinner ? "The winning bid" : `Bid ${bid.i + 1}`}
          </h1>
          <p className="hash" style={{ color: "var(--on-ink-dim)", fontSize: 13 }}>
            {HAS_EXPLORER ? (
              <a href={explorerAddress(bid.bidder)} target="_blank" rel="noreferrer noopener">
                {bid.bidder}
              </a>
            ) : (
              bid.bidder
            )}
          </p>

          <div className="grid grid-auto-160" style={{ marginTop: 26, borderColor: "var(--ink-line)" }}>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Weighted total</div>
              <div className="stat-value">
                {bid.status === "scored" ? bid.total : " - "}
                {bid.status === "scored" ? <small> of {maxTotal(round)}</small> : null}
              </div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Rank</div>
              <div className="stat-value">
                {bid.rank ? `${bid.rank} of ${ranked.length}` : " - "}
              </div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Status</div>
              <div className="stat-value" style={{ fontSize: 18 }}>
                {bid.status}
              </div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Deposit</div>
              <div className="stat-value" style={{ fontSize: 18 }}>
                {formatGen(bid.deposit, 2)} <small>GEN</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* the seal */}
      <section className="section-tight on-cream">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">The seal</div>
            <div className="eyebrow-note">sha256 - bidder-bound - salted</div>
          </div>
          <div className="panel">
            <div className="panel-body">
              <div className="label" style={{ marginBottom: 8 }}>
                Commitment, submitted {formatDate(bid.committed_at, true)}
              </div>
              <p className="hash" style={{ fontSize: 13, color: "var(--ink)" }}>
                {bid.commitment}
              </p>
              <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)", marginTop: 14 }}>
                The digest covers a bidder-chosen salt, the bidder&rsquo;s own address, and the
                proposal text, in that order. The address is inside the hash so a commitment
                copied out of public state during the commit window cannot be opened by whoever
                copied it; the salt is what stops a short proposal - a price, a single number -
                from being brute-forced back out of the digest.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* scorecard */}
      {bid.status === "scored" ? (
        <section className="section-tight on-band">
          <div className="shell">
            <div className="eyebrow-row">
              <div className="eyebrow">Scorecard</div>
              <div className="eyebrow-note">
                scored {formatDate(bid.scored_at, true)}
                {bid.rescored ? " - re-scored on appeal" : ""}
              </div>
            </div>
            <div className="card" style={{ boxShadow: "none" }}>
              <Scorecard
                criteria={round.criteria}
                left={bid}
                right={!isWinner && winner ? winner : null}
                leftLabel={isWinner ? "This bid" : "This bid"}
                rightLabel="Winning bid"
                bidCount={ranked.length}
                awardedTo={round.status === "awarded" ? round.awarded_to : undefined}
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* the proposal */}
      <section className="section-tight on-cream">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">The proposal, as revealed</div>
            <div className="eyebrow-note">
              {truncated
                ? `first ${bid.proposal.length.toLocaleString("en-US")} of ${bid.proposal_length.toLocaleString("en-US")} characters`
                : `${bid.proposal_length.toLocaleString("en-US")} characters`}
            </div>
          </div>
          {bid.proposal ? (
            <div className="panel">
              <pre
                style={{
                  margin: 0,
                  padding: "22px 24px",
                  fontFamily: "var(--mono)",
                  fontSize: 13.5,
                  lineHeight: 1.7,
                  color: "var(--body)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {bid.proposal}
              </pre>
              {truncated ? (
                <div className="note note-warn" style={{ margin: "0 24px 22px" }}>
                  The rest of this proposal could not be read just now, so the text above stops
                  short of the end. Reload to read it in full - nothing about the bid has
                  changed.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty">
              <p>
                Nothing to show. This bid&rsquo;s proposal was never revealed, so the contract
                holds only the digest above - the text does not exist on chain and never did.
              </p>
            </div>
          )}
          <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--faint)", marginTop: 14, maxWidth: "70ch" }}>
            Publishing the text is what makes the scorecard above checkable. Every reason the
            network wrote points at something in this document, and anyone can read both and
            disagree - which is the only form of accountability a scoring process can actually
            offer.
          </p>
        </div>
      </section>
    </>
  );
}
