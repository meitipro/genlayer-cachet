import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import Clarifications from "@/components/Clarifications";
import { Countdown, StaleWatch } from "@/components/Live";
import { CriteriaBlock, RoundTimeline, Scorecard, StatusTag } from "@/components/Round";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getQuestions, getRound, readRound } from "@/lib/cachet";
import { explorerAddress, HAS_EXPLORER, IS_STUDIO, NETWORK_LABEL } from "@/lib/chain";
import {
  countdown,
  formatDate,
  formatGen,
  humanError,
  maxTotal,
  phaseOf,
  scoredBids,
  shortAddress,
  timeUntil,
} from "@/lib/format";
import type { Bid, Round } from "@/lib/types";

export const revalidate = 15;

type Props = { params: { id: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await readRound(Number(params.id));
  // The title is a claim too, and it is the one that ends up in a browser tab
  // and in a shared link preview. "Round not found" for a round we simply
  // could not read is the same lie as a 404, just more widely quoted.
  if (result.state === "absent") return { title: "Round not found" };
  if (result.state === "unavailable") return { title: `Round ${params.id}` };
  const { round } = result.value;
  return {
    title: `Round ${round.id} - ${round.title}`,
    description: `${round.criteria.length} criteria, ${formatGen(round.budget)} GEN escrowed, ${round.bids} bids. Every scorecard published.`,
  };
}

export default async function RoundPage({ params }: Props) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 0) notFound();

  const result = await readRound(id);
  // Only a contract that ANSWERED "no such round" earns a 404. A read that
  // never landed - a rate limit, a dropped connection - must offer a retry:
  // a 404 is a permanent claim about the world, and this one would be false.
  if (result.state === "absent") notFound();
  if (result.state === "unavailable") return <RoundUnavailable id={id} />;

  const { round } = result.value;
  // NULL means the bids read did not land. Everything below that counts, sorts
  // or reports on bids has to say so rather than treat it as an empty round.
  const bids = result.value.bids;
  const bidsUnread = bids === null;
  const rows = bids ?? [];
  const now = Date.now();
  const phase = phaseOf(round, now);
  // Read only when there is something to read, or when the window is still
  // open and somebody might ask. A settled round with no questions should not
  // spend a request out of thirty a minute to confirm that.
  const questions =
    round.questions > 0 || phase === "commit" ? await getQuestions(round.id) : [];
  const ranked = scoredBids(rows);
  // LEADING IS NOT WINNING.
  //
  // `ranked[0]` is whichever scored bid is top at this instant, on any round -
  // including one still taking bids, and one that was declined. Passing that
  // straight through as the winner put an AWARDED tag on a bid the chain had
  // not awarded anything to, on a site whose entire claim is that it reports
  // what the contract says.
  //
  // The winner is the address the contract recorded, and only once it has.
  const leader = ranked[0] ?? null;
  const winner =
    round.status === "awarded"
      ? (ranked.find(
          (b) => b.bidder.toLowerCase() === String(round.awarded_to).toLowerCase(),
        ) ?? leader)
      : null;
  const unscored = rows.filter((b) => b.status === "revealed");
  const appeals = rows.filter((b) => b.appeal_status === "open");

  // The instants still ahead of this render. If the reader's clock crosses one
  // of them, the phase, the timeline and the button above are all describing a
  // round that has moved on, and StaleWatch says so instead of letting the
  // page keep looking live.
  const upcoming = [round.commit_closes, round.reveal_closes, round.decide_closes].filter(
    (iso) => new Date(iso).getTime() > now,
  );

  return (
    <>
      <StaleWatch upcoming={upcoming} />

      {/* header block */}
      <section className="on-ink section-tight">
        <div className="shell">
          <div className="breadcrumb">
            <Link href="/rounds" style={{ color: "var(--on-ink-dim)" }}>
              THE DOCKET
            </Link>{" "}
            / ROUND {round.id}
          </div>
          <div className="row row-between" style={{ alignItems: "flex-start", gap: 20 }}>
            <div style={{ flex: "1 1 420px" }}>
              <h1
                style={{
                  fontWeight: 800,
                  fontSize: "clamp(28px,3.6vw,44px)",
                  lineHeight: 1.05,
                  letterSpacing: "-.035em",
                  margin: "0 0 14px",
                }}
              >
                {round.title}
              </h1>
              {round.summary ? (
                <p
                  style={{
                    fontSize: 16.5,
                    lineHeight: 1.55,
                    color: "var(--on-ink-dim)",
                    maxWidth: "62ch",
                    margin: 0,
                  }}
                >
                  {round.summary}
                </p>
              ) : null}
            </div>
            <div className="stack-tight" style={{ alignItems: "flex-end" }}>
              <StatusTag round={round} now={now} />
              {/* The one action this page owes a reader who came to bid.
                  Sealing and opening a seal are the same screen in sequence,
                  and so are the two things that come after: contesting a mark
                  and pulling what you are owed.

                  This used to appear only in the commit and reveal windows,
                  which put the appeal and the claim on a page nobody could
                  navigate to at the moment they needed either. An appeal
                  happens after scoring and a claim after settlement, so a
                  bidder would have had to type the URL. */}
              <Link href={`/bid/${round.id}`} className="btn btn-primary btn-small">
                {phase === "commit"
                  ? "Seal a proposal"
                  : phase === "reveal"
                    ? "Open your seal"
                    : "Your bid"}
              </Link>
            </div>
          </div>

          <div className="grid grid-auto-160" style={{ marginTop: 30, borderColor: "var(--ink-line)" }}>
            <Stat label="Budget escrowed" value={`${formatGen(round.budget)}`} unit="GEN" dark />
            <Stat label="Bids" value={String(round.bids)} dark />
            <Stat label="Criteria" value={String(round.criteria.length)} dark />
            <Stat
              label="Tie break"
              value={`Criterion ${round.primary_index + 1}`}
              dark
              small
            />
            <Stat
              label="Buyer"
              value={shortAddress(round.buyer)}
              dark
              small
              href={`/buyers/${round.buyer}`}
            />
          </div>
        </div>
      </section>

      {/* state banner: the three states the brief says must be designed */}
      <StateNotice
        round={round}
        phase={phase}
        unscored={unscored}
        appeals={appeals}
        now={now}
      />

      {/* timeline */}
      <section className="section-tight on-cream">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">Timeline</div>
            <div className="eyebrow-note">all times utc</div>
          </div>
          <RoundTimeline round={round} now={now} />
        </div>
      </section>

      {/* criteria */}
      <section className="section-tight on-band">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">The published standard</div>
            <div className="eyebrow-note">
              frozen {formatDate(round.published_at, true)}
            </div>
          </div>
          <CriteriaBlock
            criteria={round.criteria}
            primaryIndex={round.primary_index}
            hash={round.criteria_hash}
          />
          {round.eligibility ? (
            <div className="note" style={{ marginTop: 16 }}>
              <strong>Eligibility.</strong> This round applies the deterministic rule{" "}
              <code className="mono">{round.eligibility}</code>, checked in code rather than by a
              model - anything needing judgment belongs in the criteria above, where every bidder
              reads it before writing a word.
              <br />
              <br />
              It is evaluated <strong>when a bid is committed</strong>, and not again afterwards.
              A rule that could turn against a bidder after they had paid a deposit would be a
              trap, since <code className="mono">no_prior_award</code> depends on rounds they do
              not control. It therefore means &ldquo;had not already won here when they bid&rdquo;
              - which does leave two concurrent rounds able to award the same address.
            </div>
          ) : null}
        </div>
      </section>

      {/* the award */}
      {round.status === "awarded" && winner ? (
        <section className="section-tight on-cream">
          <div className="shell">
            <div className="eyebrow-row">
              <div className="eyebrow">The award</div>
              <div className="eyebrow-note">
                settled {formatDate(round.settled_at, true)}
              </div>
            </div>
            <div className="panel">
              <div className="panel-body">
                <div className="row row-between" style={{ alignItems: "flex-start" }}>
                  <div>
                    <div className="label" style={{ marginBottom: 8 }}>
                      Awarded to
                    </div>
                    <div className="hash" style={{ fontSize: 14, color: "var(--ink)" }}>
                      {HAS_EXPLORER ? (
                        <a
                          href={explorerAddress(round.awarded_to)}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {round.awarded_to}
                        </a>
                      ) : (
                        round.awarded_to
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="label" style={{ marginBottom: 8 }}>
                      Weighted total
                    </div>
                    <div className="kv-value" style={{ fontSize: 30 }}>
                      {round.awarded_total}
                      <small> of {maxTotal(round)}</small>
                    </div>
                  </div>
                </div>
                <p
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    color: "var(--muted)",
                    marginTop: 18,
                  }}
                >
                  {formatGen(round.budget)} GEN was escrowed at publication. The award transfer
                  fires on <strong>finality</strong>, not on acceptance - the status you are
                  reading changed earlier so that every bidder could read their scorecard during
                  the appeal window.
                  {round.fee_bps
                    ? ` A round fee of ${round.fee_bps / 100}% applies at award and never on a declined round.`
                    : ""}
                </p>
                {IS_STUDIO ? (
                  <p
                    className="mono"
                    style={{ fontSize: 12, lineHeight: 1.5, color: "var(--faint)", marginTop: 12 }}
                  >
                    On {NETWORK_LABEL} the transfer is emitted correctly and the contract is
                    debited, but the ledger does not credit an ordinary account - so the winner
                    will see this award recorded and their balance unchanged.{" "}
                    <Link href="/docs#studio">Why that is the network, not the contract.</Link>
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {round.status === "declined" ? (
        <section className="section-tight on-cream">
          <div className="shell">
            <div className="eyebrow-row">
              <div className="eyebrow">Declined</div>
              <div className="eyebrow-note">
                settled {formatDate(round.settled_at, true)}
              </div>
            </div>
            <div className="note note-warn">
              <strong>No bid was awarded, and the budget returned to the buyer.</strong>
              <br />
              {humanError(round.decline_reason)}
              <br />
              <br />
              A buyer may decline, and that possibility is stated in the tender before bidding
              opens. What a buyer cannot do is decline before every revealed bid has been scored,
              or sit past the decision window - after that the round settles without them.
            </div>
          </div>
        </section>
      ) : null}

      {/* scorecards */}
      <section className="section-tight on-band">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">Scorecards</div>
            <div className="eyebrow-note">
              {ranked.length} scored - {round.expired} expired - {unscored.length} awaiting a score
              {round.withdrawn > 0 ? ` - ${round.withdrawn} withdrawn` : ""}
            </div>
          </div>

          {/* The empty state is about having NOTHING to show, not about having
              nothing scored. Gating on the score alone hid every expired,
              still-sealed and withdrawn row behind "no bid has been scored",
              so a round where several things demonstrably happened rendered as
              though nothing had. */}
          {phase === "commit" ? (
            <SealedNotice round={round} now={now} />
          ) : bidsUnread ? (
            <div className="empty">
              <p>
                The bids on this round could not be read, so this is not a claim that there were
                none - the round itself reports {round.bids} bid{round.bids === 1 ? "" : "s"}.
                <br />
                <Link href={`/r/${round.id}`}>Try again.</Link>
              </p>
            </div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <p>No bid was ever sealed on this round.</p>
            </div>
          ) : (
            <div className="stack">
              {ranked.map((b) => (
                <BidBlock
                  key={b.i}
                  round={round}
                  bid={b}
                  winner={winner}
                  leader={leader}
                  total={ranked.length}
                />
              ))}
              {unscored.map((b) => (
                <PendingBlock key={b.i} bid={b} />
              ))}
              {rows
                .filter((b) => b.status === "expired")
                .map((b) => (
                  <ExpiredBlock key={b.i} bid={b} />
                ))}
              {/* A commitment nobody opened, after the window shut. It still
                  reads as sealed because expiry is a real state change with a
                  moment attached and nobody has paid for it yet. */}
              {rows
                .filter((b) => b.status === "sealed")
                .map((b) => (
                  <SealedBlock key={b.i} bid={b} />
                ))}
              {/* Listed rather than hidden. A withdrawal is part of what
                  happened in this round, and a docket that silently dropped
                  the rows it found inconvenient would be the wrong kind of
                  record. */}
              {rows
                .filter((b) => b.status === "withdrawn")
                .map((b) => (
                  <WithdrawnBlock key={b.i} bid={b} />
                ))}
              {ranked.length === 0 && unscored.length === 0 ? (
                <p className="help" style={{ margin: 0 }}>
                  No bid in this round was scored, so there is no scorecard to compare. Every
                  commitment that was made is listed above with what became of it.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {/* clarifications */}
      <section className="section-tight on-cream" id="questions">
        <div className="shell">
          <Clarifications
            roundId={round.id}
            buyer={round.buyer}
            questions={questions}
            open={phase === "commit"}
          />
        </div>
      </section>

      {/* appeal */}
      <section className="section-tight on-cream" id="appeal">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">Appealing a score</div>
            <div className="eyebrow-note">
              bond {formatGen(round.appeal_bond, 2)} GEN
            </div>
          </div>
          <div className="panel">
            <div className="panel-body prose">
              <p>
                A bidder whose score on a specific criterion looks wrong against their own
                proposal text can contest it. Both are public after the reveal, so the claim is
                checkable by anyone.
              </p>
              <p>
                The appeal is re-scored against the <strong>same proposal</strong>. The argument
                is treated as a claim about text that was hash-committed before anyone saw a
                score - if it points at wording that is genuinely there, that wording is taken
                into account; if it asserts anything the proposal does not say, it is ignored. An
                appeal cannot become a second, unsealed bid.
              </p>
              <p>
                <strong>The award is held while an appeal is open.</strong> A tender that paid out
                during a live scoring appeal would make the appeal meaningless. If the total
                moves, the appeal is upheld and the bond comes back; if it does not, the bond pays
                for the re-scoring. Resolving is permissionless, so nobody needs the appellant&rsquo;s
                cooperation to unblock the round.
              </p>
              <p>
                An appeal can be opened at any time while this round is still open. It is bounded
                by settlement rather than by the decision window, because scoring has no deadline
                and a bid scored late would otherwise get no window at all.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * The read did not land, so we do not know whether this round exists.
 *
 * Says exactly that, and offers the one useful action. Anything that implied
 * the round was gone would be a permanent-sounding claim built on a transient
 * fact.
 */
function RoundUnavailable({ id }: { id: number }) {
  return (
    <>
      {CONFIGURED ? <Unreachable what="this round" /> : <NotConfigured />}
    <section className="section on-cream">
      <div className="shell">
        <div className="eyebrow-row">
          <div className="eyebrow">Round {id}</div>
          <div className="eyebrow-note">
            {CONFIGURED ? "could not read the chain" : "no contract configured"}
          </div>
        </div>
        <h1 className="display" style={{ maxWidth: "20ch" }}>
          This round could not be read.
        </h1>
        <p className="lede">
          {CONFIGURED
            ? "The contract did not answer, so we do not know whether this round exists. That is almost always the network’s rate limit - it allows 30 requests a minute and 500 an hour per address, shared across everything on this machine. Nothing is wrong with the round."
            : "No contract is configured for this network, so there is nothing to read."}
        </p>
        {/* "Try again" is only an action when trying again could work. With no
            address set, the fix is a rebuild, so offering a retry would send the
            reader round a loop that cannot terminate. */}
        <div className="btn-row">
          {CONFIGURED ? (
            <Link href={`/r/${id}`} className="btn btn-primary">
              Try again
            </Link>
          ) : null}
          <Link href="/rounds" className={CONFIGURED ? "btn btn-ghost" : "btn btn-primary"}>
            Back to the docket
          </Link>
        </div>
      </div>
    </section>
    </>
  );
}

function Stat({
  label,
  value,
  unit,
  dark,
  small,
  href,
}: {
  label: string;
  value: string;
  unit?: string;
  dark?: boolean;
  small?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div
        className="stat-value"
        style={small ? { fontSize: 17, fontFamily: "var(--mono)", letterSpacing: 0 } : undefined}
      >
        {value}
        {unit ? <small> {unit}</small> : null}
      </div>
    </>
  );
  return (
    <div className="stat" style={dark ? { borderColor: "var(--ink-line)" } : undefined}>
      {href ? (
        <Link href={href} style={{ color: "inherit", display: "block" }}>
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

/** The states the brief says must be designed, each named rather than inferred. */
function StateNotice({
  round,
  phase,
  unscored,
  appeals,
  now,
}: {
  round: Round;
  phase: string;
  unscored: Bid[];
  appeals: Bid[];
  now: number;
}) {
  if (appeals.length) {
    return (
      <Notice warn>
        <strong>
          {appeals.length} appeal{appeals.length === 1 ? " is" : "s are"} open, and the award is
          held.
        </strong>{" "}
        Resolving an appeal is permissionless - anyone can push it, including the buyer.
      </Notice>
    );
  }
  if (unscored.length && phase !== "commit") {
    return (
      <Notice warn>
        <strong>
          {unscored.length} revealed bid{unscored.length === 1 ? "" : "s"} still{" "}
          {unscored.length === 1 ? "has" : "have"} no score, so this round cannot be awarded.
        </strong>{" "}
        Named here rather than quietly skipped: nobody wins by being the only bid the network
        could read. Scoring is permissionless.
      </Notice>
    );
  }
  if (phase === "commit") {
    return (
      <Notice>
        <strong>The commit window is open.</strong> Bid contents are genuinely unavailable - the
        contract holds a sha256 digest and nothing else. Commits close{" "}
        <Countdown at={round.commit_closes} initial={countdown(round.commit_closes, now)} />, on{" "}
        {formatDate(round.commit_closes, true)}.
      </Notice>
    );
  }
  if (phase === "reveal") {
    return (
      <Notice>
        <strong>The reveal window is open.</strong> Proposals are being opened and checked against
        their seals. Reveals close{" "}
        <Countdown at={round.reveal_closes} initial={countdown(round.reveal_closes, now)} />, on{" "}
        {formatDate(round.reveal_closes, true)}.
      </Notice>
    );
  }
  return null;
}

function Notice({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <div className={warn ? "banner banner-warn" : "banner"}>
      <div className="banner-inner" style={{ letterSpacing: 0, fontFamily: "var(--sans)", fontSize: 13.5 }}>
        <span>{children}</span>
      </div>
    </div>
  );
}

function SealedNotice({ round, now }: { round: Round; now: number }) {
  return (
    <div className="empty">
      <p style={{ maxWidth: "58ch", margin: "0 auto" }}>
        <strong>{round.sealed}</strong> sealed commitment{round.sealed === 1 ? "" : "s"} so far.
        Nothing about them is readable, by anyone, including the buyer - the contract holds a
        sha256 digest per bid and no text at all.
        <br />
        <br />
        Scorecards appear after the reveal window, which opens{" "}
        <Countdown at={round.commit_closes} initial={countdown(round.commit_closes, now)} />.
      </p>
    </div>
  );
}

function BidBlock({
  round,
  bid,
  winner,
  leader,
  total,
}: {
  round: Round;
  bid: Bid;
  /** Only set once the contract has actually awarded this round. */
  winner: Bid | null;
  /** Top scored bid right now, on any round. Used only for the comparison. */
  leader: Bid | null;
  total: number;
}) {
  const isWinner = winner !== null && winner.i === bid.i;
  const isLeader = leader !== null && leader.i === bid.i;
  return (
    <div className="card" style={{ boxShadow: "none" }}>
      <div className="chrome">
        <span>
          BID {bid.i + 1} - <BidderLink address={bid.bidder} />
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {bid.rescored ? (
            <span className="tag tag-quiet" style={{ color: "var(--on-ink-dim)" }}>
              RE-SCORED ON APPEAL
            </span>
          ) : null}
          {bid.appeal_status === "upheld" ? (
            <span className="tag tag-live" style={{ color: "var(--accent-ink)" }}>
              APPEAL UPHELD
            </span>
          ) : null}
          {bid.appeal_status === "rejected" ? (
            <span className="tag tag-quiet" style={{ color: "var(--on-ink-dim)" }}>
              APPEAL REJECTED
            </span>
          ) : null}
          {bid.appeal_status === "abandoned" ? (
            <span className="tag tag-quiet" style={{ color: "var(--on-ink-dim)" }}>
              APPEAL NEVER JUDGED
            </span>
          ) : null}
          <span
            className={`tag ${isWinner ? "tag-live" : "tag-quiet"}`}
            style={{ color: isWinner ? "var(--accent-ink)" : "var(--on-ink-dim)" }}
          >
            {isWinner ? "AWARDED" : `RANK ${bid.rank} OF ${total}`}
          </span>
        </span>
      </div>

      <Scorecard
        criteria={round.criteria}
        left={bid}
        // Compared against the winner once there is one, and against whoever
        // is top otherwise. Never against itself.
        right={!isLeader && leader ? leader : null}
        leftLabel={isWinner ? "This bid" : `Bid ${bid.i + 1}`}
        rightLabel={winner ? "Winning bid" : "Leading bid"}
        bidCount={total}
        awardedTo={round.status === "awarded" ? round.awarded_to : undefined}
      />

      {bid.appeal_argument ? (
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-soft)" }}>
          <div className="label" style={{ marginBottom: 8 }}>
            Appeal argument, {bid.appeal_status}
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", margin: 0 }}>
            {bid.appeal_argument}
          </p>
          {bid.rescored ? (
            <p className="mono" style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>
              total before {bid.appeal_total_before} → after {bid.total}
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        className="row row-between"
        style={{ padding: "14px 24px", borderTop: "1px solid var(--line-soft)" }}
      >
        {/* Only the stages that actually happened. Printing "REVEALED -" for a
            bid that was never opened reads as a missing value rather than as a
            stage that does not exist. */}
        <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
          {(
            [
              ["SEALED", bid.committed_at],
              ["REVEALED", bid.revealed_at],
              ["SCORED", bid.scored_at],
            ] as const
          )
            .filter(([, at]) => Boolean(at))
            .map(([label, at]) => `${label} ${formatDate(at)}`)
            .join(" - ")}
        </span>
        <Link href={`/r/${round.id}/b/${bid.i}`} className="btn btn-ghost btn-small">
          Read the proposal
        </Link>
      </div>
    </div>
  );
}

/**
 * A bidder's address, linked to their record.
 *
 * Worth a link everywhere it appears: the address on its own says nothing,
 * and the whole reason the record exists is that a reader looking at one bid
 * usually wants to know what this address has done elsewhere.
 */
function BidderLink({ address }: { address: string }) {
  return (
    <Link href={`/bidders/${address}`} className="bidder-link">
      {shortAddress(address)}
    </Link>
  );
}

function WithdrawnBlock({ bid }: { bid: Bid }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label">
          Bid {bid.i + 1} - <BidderLink address={bid.bidder} />
        </span>
        <span className="tag tag-quiet">WITHDRAWN</span>
      </div>
      <div className="panel-body">
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", margin: 0 }}>
          Sealed on {formatDate(bid.committed_at)} and pulled on{" "}
          {formatDate(bid.withdrawn_at, true)}, while the commit window was still open. No
          proposal was ever opened, the deposit went back, and the slot returned to the round.
          <br />
          <br />
          This is not the same as a commitment that expired: nobody was left waiting on it, and
          nothing was forfeited.
        </p>
      </div>
    </div>
  );
}

function PendingBlock({ bid }: { bid: Bid }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label">
          Bid {bid.i + 1} - <BidderLink address={bid.bidder} />
        </span>
        <span className="tag tag-quiet">AWAITING A SCORE</span>
      </div>
      <div className="panel-body">
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", margin: 0 }}>
          Revealed {formatDate(bid.revealed_at, true)} and matched its seal. It has not been
          scored yet, and the round cannot be awarded until it is. Anyone can trigger the scoring
          - it is not the buyer&rsquo;s to withhold.
        </p>
      </div>
    </div>
  );
}

function ExpiredBlock({ bid }: { bid: Bid }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label">
          Bid {bid.i + 1} - <BidderLink address={bid.bidder} />
        </span>
        <span className="tag tag-quiet">EXPIRED UNSCORED</span>
      </div>
      <div className="panel-body">
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", margin: 0 }}>
          A commitment was sealed on {formatDate(bid.committed_at)} and never opened before the
          reveal window closed. The entry deposit of {formatGen(bid.deposit, 2)} GEN is forfeited,
          which is what pays for scoring the bids that did arrive.
        </p>
        <p className="hash" style={{ marginTop: 12 }}>
          {bid.commitment}
        </p>
      </div>
    </div>
  );
}

function SealedBlock({ bid }: { bid: Bid }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label">
          Bid {bid.i + 1} - <BidderLink address={bid.bidder} />
        </span>
        <span className="tag tag-quiet">STILL SEALED</span>
      </div>
      <div className="panel-body">
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", margin: 0 }}>
          This commitment was never opened and the reveal window has closed. It is still recorded
          as sealed because expiry is a real state change with a moment attached, and nobody has
          paid for it yet. Anyone can settle it.
        </p>
      </div>
    </div>
  );
}
