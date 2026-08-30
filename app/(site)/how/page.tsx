import Link from "next/link";
import type { Metadata } from "next";

import ViewHead from "@/components/app/ViewHead";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getRounds } from "@/lib/cachet";
import { formatDate, phaseOf } from "@/lib/format";
import type { Round } from "@/lib/types";

export const revalidate = 15;

export const metadata: Metadata = { title: "How it works" };

/**
 * The handoff's How it works pane.
 *
 * Five stages down the left, and on the right where a live round currently
 * stands plus what the shape of the thing rules out.
 *
 * The design fixes its own example - "Round 31 is here", "Stage 3 - Reveal",
 * "52% through the round". Those are the parts that have to be read rather
 * than typed: a protocol explainer whose "where you are" is a constant is a
 * diagram, and this pane sits inside the dApp precisely so it is not one. The
 * stage badges and the whole right-hand card come from whichever round is
 * actually live.
 *
 * When no round is live it says so rather than borrowing a settled one. The
 * five stages are still worth reading with nothing in flight, which is why
 * they are not hidden in that state.
 */

type Stage = {
  n: string;
  title: string;
  body: string;
  /** The design's own icon path for this stage. */
  icon: string;
};

const STAGES: Stage[] = [
  {
    n: "01",
    title: "Publish the tender",
    body: "The buyer writes the scope, budget, criteria and their weights on-chain, then opens the round. Once published, none of it can be edited - every bidder reads the same brief.",
    icon: "M5 3h8l3 3v12H5zM13 3v3h3M8 11h5M8 14h5",
  },
  {
    n: "02",
    title: "Seal your bid",
    body: "You commit a hash of your proposal, not the proposal itself. The chain records that you bid and when, while the contents stay unreadable - to the buyer and to every rival.",
    icon: "M6 9V7a4.5 4.5 0 019 0v2M4.5 9h12v8.5h-12zM10.5 12.5v2.5",
  },
  {
    n: "03",
    title: "Reveal after the window",
    body: "When the commit window closes, everyone reveals at once. The chain checks each proposal against the hash it already holds, so a late rewrite is arithmetically impossible.",
    icon: "M2.5 10.5S5.5 5 10.5 5s8 5.5 8 5.5-3 5.5-8 5.5-8-5.5-8-5.5zM10.5 8.5a2 2 0 100 4 2 2 0 000-4z",
  },
  {
    n: "04",
    title: "Validators score it",
    body: "GenLayer validators grade each revealed proposal against the published criteria, independently and in parallel. Their grades are reconciled into one scorecard, with the reasoning attached.",
    icon: "M4 16V9M9 16V4M14 16v-5M19 16v-9",
  },
  {
    n: "05",
    title: "Award, then appeal",
    // The design reads "escrow releases on the milestones", "for six days
    // after", and "any bidder can bond GEN to have a single criterion
    // re-scored". Four clauses are corrected against the contract and the rest
    // is the design's own sentence:
    //
    //   no milestones      the winner is paid the budget less the fee in one
    //                      transfer on award
    //   not six days       the appeal window is bounded by the round still
    //                      being open, which is what `appeal_score` checks
    //   not any bidder     `ERR_NOT_BIDDER` - only the bid's own bidder, and
    //                      `ERR_APPEAL_TWICE` - once per bid
    //   not one criterion  `resolve_appeal` re-scores the whole card against
    //                      every criterion, with the argument attached as a
    //                      claim about the text
    body:
      "The highest score takes the contract and escrow releases to the winner on award. For as long as the round stays open, a bidder can bond GEN once to have their own card re-scored by a fresh validator set, with their argument in front of it.",
    icon: "M10.5 3l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L3 8.5l5.2-.8z",
  },
];

const RULES_OUT = [
  "Reading a rival bid before the window shuts",
  "Moving the criteria once bids are in",
  "Rewriting a proposal after reveal",
  "An award with no reasoning attached",
];

/** Which stage a round is standing on, 1 to 5. */
function stageOf(round: Round, now: number): number {
  switch (phaseOf(round, now)) {
    case "commit":
      return 2;
    case "reveal":
      return 3;
    case "decide":
      // Scoring and awarding share a window. A round with everything scored is
      // waiting on the award; anything less is still being scored.
      return round.scored >= round.bids && round.bids > 0 ? 5 : 4;
    default:
      return 5;
  }
}

/**
 * How far through its own timeline a round is, 0 to 100.
 *
 * Measured from publication to the decision deadline, which is the span the
 * round actually controls. Clamped, because a round sitting past its decision
 * window is at the end of it rather than at 140%.
 */
function progressOf(round: Round, now: number): number {
  const start = new Date(round.published_at).getTime();
  const end = new Date(round.decide_closes).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

export default async function HowPage() {
  const page = await getRounds(0, 24);

  if (!CONFIGURED) return <NotConfigured />;
  if (!page) return <Unreachable what="the protocol view" />;

  const now = Date.now();
  // The round to narrate: the newest one still running. A settled round has
  // nowhere to be, and pointing at one would make "where you are" a history
  // lesson.
  const live = page.rounds.find((r) => r.status === "open") ?? null;
  const here = live ? stageOf(live, now) : 0;

  return (
    <div className="shell view-pane">
      <ViewHead
        title="How it works"
        sub="One round, from a published brief to an award you can argue with."
        actionLabel="Open the docket"
        actionHref="/rounds"
      />

      <div className="how-cols">
        <section className="panel">
          <div className="panel-head">
            <span className="label">One round, end to end</span>
            <span className="label">{STAGES.length} STAGES</span>
          </div>
          <div className="panel-body">
            <p className="how-lede">
              A tender on Cachet runs on the same rails every time. Nothing about a bid is
              readable until the window shuts, and nothing about the criteria can move after it
              opens.
            </p>

            <ol className="how-steps">
              {STAGES.map((s, i) => {
                const n = i + 1;
                const state = here === 0 ? "idle" : n < here ? "done" : n === here ? "now" : "ahead";
                return (
                  <li key={s.n} className={`how-step is-${state}`}>
                    <div className="how-rail" aria-hidden="true">
                      <span className="how-icon">
                        <svg
                          width="17"
                          height="17"
                          viewBox="0 0 21 21"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d={s.icon} />
                        </svg>
                      </span>
                      {i < STAGES.length - 1 ? <span className="how-line" /> : null}
                    </div>
                    <div className="how-body">
                      <div className="how-top">
                        <span className="how-n mono">{s.n}</span>
                        <h3 className="how-title">{s.title}</h3>
                        {state === "done" ? (
                          <span className="how-badge done">SETTLED</span>
                        ) : state === "now" && live ? (
                          <span className="how-badge now">ROUND {live.id} IS HERE</span>
                        ) : state === "ahead" ? (
                          <span className="how-badge">AHEAD</span>
                        ) : null}
                      </div>
                      <p className="how-text">{s.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <div className="how-side">
          <section className="panel how-here">
            <div className="panel-head">
              <span className="label">Where you are</span>
            </div>
            <div className="panel-body">
              {live ? (
                <>
                  <div className="how-here-stage">
                    Stage {here} - {STAGES[here - 1].title}
                  </div>
                  <p className="how-here-line">
                    Round {live.id} is {phaseOf(live, now) === "commit" ? "taking sealed bids" : phaseOf(live, now) === "reveal" ? "open for reveals" : "waiting on its decision"}.
                    The decision window closes {formatDate(live.decide_closes)}.
                  </p>
                  <div className="how-bar" aria-hidden="true">
                    <span style={{ width: `${progressOf(live, now)}%` }} />
                  </div>
                  <div className="how-pct mono">{progressOf(live, now)}% THROUGH THE ROUND</div>
                  <Link href="/my-bids" className="btn btn-ghost btn-small how-here-go">
                    Check my sealed bids
                  </Link>
                </>
              ) : (
                <>
                  <div className="how-here-stage">Nothing in flight</div>
                  <p className="how-here-line">
                    No round is running, so there is no stage to stand on. The five above are
                    what will happen when one opens.
                  </p>
                  <Link href="/publish" className="btn btn-ghost btn-small how-here-go">
                    Publish a tender
                  </Link>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="label">What this rules out</span>
            </div>
            <div className="panel-body">
              <ul className="how-rules">
                {RULES_OUT.map((r) => (
                  <li key={r}>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 21 21"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 11l4 4 9-9" />
                    </svg>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
