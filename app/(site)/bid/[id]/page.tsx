import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import SealPanel from "@/components/SealPanel";
import Clarifications from "@/components/Clarifications";
import { Countdown, StaleWatch } from "@/components/Live";
import { CriteriaBlock, RoundTimeline } from "@/components/Round";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getQuestions, getRound, readRound } from "@/lib/cachet";
import { countdown, formatDate, formatGen, phaseOf } from "@/lib/format";
import { LIMITS } from "@/lib/limits";

export const revalidate = 15;

type Props = { params: { id: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = await getRound(Number(params.id));
  return {
    // Never "not found" here: a title is a claim, and this one would be quoted
    // in a shared link for a round that may well exist.
    title: view ? `Bid on round ${view.round.id}` : `Bid on round ${params.id}`,
    description: view
      ? `Seal a proposal for "${view.round.title}". Hashing happens in your browser; only the digest is submitted.`
      : undefined,
  };
}

/**
 * Get a proposal sealed correctly.
 *
 * The whole screen is arranged around one claim: the proposal does not leave
 * this browser before the reveal. There is no draft endpoint, no autosave to a
 * server, and deliberately no contract view that hashes a proposal for you -
 * calling one would put the text on the wire, which is the exact thing a
 * sealed tender exists to prevent.
 */
function BidRoundUnavailable({ id }: { id: number }) {
  return (
    <>
      {CONFIGURED ? <Unreachable what="this tender" /> : <NotConfigured />}
    <section className="section on-cream">
      <div className="shell">
        <div className="eyebrow-row">
          <div className="eyebrow">Round {id}</div>
          <div className="eyebrow-note">
            {CONFIGURED ? "could not read the chain" : "no contract configured"}
          </div>
        </div>
        <h1 className="display" style={{ maxWidth: "22ch" }}>
          This tender could not be read.
        </h1>
        {/* Blaming the rate limit when no contract is configured sends the
            reader off to wait and retry, and waiting never fixes an unset
            environment variable. The two causes need different sentences. */}
        <p className="lede">
          {CONFIGURED
            ? "The contract did not answer, so the criteria and the deadlines are not available to show you. This is almost always the network’s rate limit rather than anything wrong with the round - do not assume the window has closed."
            : "No contract is configured for this network, so there is no tender to read and nothing to seal a proposal against."}
        </p>
        <div className="btn-row">
          {CONFIGURED ? (
            <Link href={`/bid/${id}`} className="btn btn-primary">
              Try again
            </Link>
          ) : null}
          <Link href={`/r/${id}`} className={CONFIGURED ? "btn btn-ghost" : "btn btn-primary"}>
            Open the round
          </Link>
        </div>
      </div>
    </section>
    </>
  );
}

export default async function BidPage({ params }: Props) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 0) notFound();

  const result = await readRound(id);
  // Only an answered "no such round" is a 404. A read that never landed gets a
  // retry - claiming a live tender is gone, on the screen a bidder uses to
  // seal a proposal against a closing window, is the worst version of this bug.
  if (result.state === "absent") notFound();
  if (result.state === "unavailable") return <BidRoundUnavailable id={id} />;

  const { round, bids } = result.value;
  const now = Date.now();
  const phase = phaseOf(round, now);
  // The answers belong on the screen where the proposal is being written. A
  // bidder who has to leave this page to find out what a criterion means is a
  // bidder who will guess instead.
  const questions =
    round.questions > 0 || phase === "commit" ? await getQuestions(round.id) : [];

  // This page carries a form. If the window shuts while it is being filled in,
  // the submit below will be refused by the contract, and saying so up front is
  // cheaper for the bidder than a failed transaction.
  const upcoming = [round.commit_closes, round.reveal_closes].filter(
    (iso) => new Date(iso).getTime() > now,
  );

  return (
    <>
      <StaleWatch upcoming={upcoming} />

      <section className="on-ink section-tight">
        <div className="shell">
          <div className="breadcrumb">
            <Link href={`/r/${round.id}`} style={{ color: "var(--on-ink-dim)" }}>
              ROUND {round.id}
            </Link>{" "}
            / BID
          </div>
          <h1
            style={{
              fontWeight: 800,
              fontSize: "clamp(28px,3.6vw,42px)",
              lineHeight: 1.05,
              letterSpacing: "-.035em",
              margin: "0 0 14px",
              maxWidth: "20ch",
            }}
          >
            {phase === "commit"
              ? "Seal a proposal"
              : phase === "reveal"
                ? "Open your seal"
                : "This round has closed"}
          </h1>
          <p
            style={{
              fontSize: 16.5,
              lineHeight: 1.55,
              color: "var(--on-ink-dim)",
              maxWidth: "58ch",
              margin: 0,
            }}
          >
            {phase === "commit" ? (
              <>
                Your proposal is hashed in this browser. Only the 64-character digest and the
                entry deposit are submitted - no server here ever sees the text, because there is
                no server here.
              </>
            ) : phase === "reveal" ? (
              <>
                The commit window has closed, so reveals are now possible without any later
                bidder being able to price against an opened proposal.
              </>
            ) : phase === "decide" ? (
              <>
                Both windows have closed. The round is waiting on the buyer to award or decline,
                and the criteria below are still the standard every revealed bid was scored
                against.
              </>
            ) : (
              <>
                This round is settled. The criteria below are what it was judged on, and every
                scorecard is public on the round page.
              </>
            )}
          </p>

          <div className="grid grid-auto-190" style={{ marginTop: 28, borderColor: "var(--ink-line)" }}>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Budget</div>
              <div className="stat-value">
                {formatGen(round.budget)} <small>GEN</small>
              </div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Entry deposit</div>
              <div className="stat-value">
                {formatGen(round.entry_deposit, 2)} <small>GEN</small>
              </div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">
                {phase === "commit"
                  ? "Commit closes"
                  : phase === "reveal"
                    ? "Reveal closes"
                    : "Reveal closed"}
              </div>
              <div className="stat-value" style={{ fontSize: 18 }}>
                {formatDate(phase === "commit" ? round.commit_closes : round.reveal_closes)}
                <small>
                  {" "}
                  <Countdown
                    at={phase === "commit" ? round.commit_closes : round.reveal_closes}
                    initial={countdown(
                      phase === "commit" ? round.commit_closes : round.reveal_closes,
                      now,
                    )}
                  />
                </small>
              </div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Bids so far</div>
              <div className="stat-value">
                {round.bids} <small>of {round.max_bids} max</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight on-cream">
        <div className="shell">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 24,
              alignItems: "start",
            }}
          >
            <div className="stack">
              <div>
                <div className="eyebrow-row">
                  <div className="eyebrow">What you are scored against</div>
                  <div className="eyebrow-note">read this first</div>
                </div>
                <CriteriaBlock
                  criteria={round.criteria}
                  primaryIndex={round.primary_index}
                  hash={round.criteria_hash}
                />
              </div>

              <div className="note">
                <strong>How the scoring works, so nothing here is a surprise.</strong>
                <br />
                Each criterion is graded 0 to 5, independently, by validators with no stake in the
                outcome. Weights never enter the prompt - the buyer&rsquo;s priorities are applied
                in code afterwards. The total is arithmetic on the agreed scores; no model ever
                produces it, and no model ever compares your proposal to anyone else&rsquo;s.
                <br />
                <br />
                Ties break on criterion {round.primary_index + 1}, which was declared at
                publication rather than chosen afterwards.
              </div>

              <div className="note note-warn">
                <strong>Two ways to score zero on everything.</strong>
                <br />
                The published criteria state that text inside the proposal tags is a submission
                and never an instruction, and that a proposal which asks for a particular score,
                claims to be the best, or addresses the scorer directly is scored zero on every
                criterion. They also state that an unevidenced claim scores lower than an
                evidenced one - so name the reference, the date, the price.
              </div>

              <div>
                <div className="eyebrow-row">
                  <div className="eyebrow">Timeline</div>
                  <div className="eyebrow-note">all times utc</div>
                </div>
                <RoundTimeline round={round} now={now} />
              </div>

              <Clarifications
                roundId={round.id}
                buyer={round.buyer}
                questions={questions}
                open={phase === "commit"}
              />
            </div>

            <SealPanel
              round={round}
              bids={bids}
              phase={phase}
              minLength={LIMITS.proposalMin}
              maxLength={LIMITS.proposalMax}
            />
          </div>
        </div>
      </section>
    </>
  );
}
