import Link from "next/link";

import {
  formatDate,
  formatGen,
  nextDeadline,
  phaseOf,
  shortAddress,
  statusLabel,
  timeUntil,
} from "@/lib/format";
import type { Bid, Criterion, Round } from "@/lib/types";

/** A live-looking dot only where the round is actually taking action. */
export function StatusTag({ round, now }: { round: Round; now: number }) {
  const label = statusLabel(round, now);
  const active = round.status === "open" && phaseOf(round, now) !== "decide";
  return (
    <span className={`tag ${active || round.status === "awarded" ? "tag-live" : "tag-quiet"}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * The published standard.
 *
 * Weights are shown next to every criterion because they are part of what was
 * published - but they never entered the prompt the network was given. That
 * separation is the whole legitimacy argument, so it is stated here rather
 * than only in the docs.
 */
export function CriteriaBlock({
  criteria,
  primaryIndex,
  hash,
}: {
  criteria: Criterion[];
  primaryIndex: number;
  hash?: string;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label">Criteria, frozen at publication</span>
        <span className="label">{criteria.length} published</span>
      </div>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {criteria.map((c) => (
          <li
            key={c.i}
            style={{
              padding: "14px 22px",
              borderBottom: "1px solid var(--line-softer)",
              display: "flex",
              gap: 12,
              alignItems: "baseline",
              flexWrap: "wrap",
            }}
          >
            <span className="mono" style={{ fontSize: 12, color: "var(--faint)", minWidth: 18 }}>
              {c.i + 1}
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, flex: "1 1 240px" }}>
              {c.text}
              <span className="weight-chip">w{c.weight}</span>
              {c.i === primaryIndex ? (
                <span className="primary-chip">TIE BREAK</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <div className="panel-body" style={{ borderTop: "1px solid var(--line-softer)" }}>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--muted)", margin: 0 }}>
          Weights are the buyer&rsquo;s and are published with the criteria. They never enter the
          prompt: the network scores each criterion on its own, and the priorities are applied in
          code afterwards. There is no method in the contract that edits either after publication.
        </p>
        {hash ? (
          <p className="hash" style={{ marginTop: 12 }}>
            criteria digest {hash}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const STEPS = ["Published", "Commit closes", "Reveal closes", "Decision closes"] as const;

export function RoundTimeline({ round, now }: { round: Round; now: number }) {
  const phase = phaseOf(round, now);
  const at = [
    round.published_at,
    round.commit_closes,
    round.reveal_closes,
    round.decide_closes,
  ];
  // Which step is "now": index 1 during the commit window, 2 during reveal, 3
  // while the buyer decides. A settled round has no current step at all.
  const current = phase === "commit" ? 1 : phase === "reveal" ? 2 : phase === "decide" ? 3 : -1;

  return (
    <div className="timeline">
      {STEPS.map((name, i) => {
        const passed = new Date(at[i]).getTime() <= now;
        const isNow = i === current;
        return (
          <div
            key={name}
            className={`timeline-step ${isNow ? "now" : passed ? "done" : ""}`}
          >
            <div className="label">
              {isNow ? "NOW" : passed ? "PASSED" : "AHEAD"}
            </div>
            <div className="timeline-name">{name}</div>
            <div className="timeline-when">
              {formatDate(at[i], true)}
              <br />
              {timeUntil(at[i], now)}
            </div>
          </div>
        );
      })}
      {round.settled_at ? (
        <div className="timeline-step done">
          <div className="label">SETTLED</div>
          <div className="timeline-name">
            {round.status === "awarded" ? "Awarded" : "Declined"}
          </div>
          <div className="timeline-when">{formatDate(round.settled_at, true)}</div>
        </div>
      ) : null}
    </div>
  );
}

export function RoundCard({ round, now }: { round: Round; now: number }) {
  const deadline = nextDeadline(round, now);
  return (
    <Link href={`/r/${round.id}`} className="docket-card">
      <div className="docket-top">
        <span className="docket-id">R{round.id}</span>
        <StatusTag round={round} now={now} />
      </div>
      <div className="docket-title">{round.title}</div>
      <div className="docket-meta">
        <span>{formatGen(round.budget)} GEN</span>
        <span>
          {round.criteria.length} CRITERI{round.criteria.length === 1 ? "ON" : "A"}
        </span>
        <span>
          {round.bids} BID{round.bids === 1 ? "" : "S"}
        </span>
        {deadline ? (
          <span>
            {deadline.label.toUpperCase()} {formatDate(deadline.at).toUpperCase()}
          </span>
        ) : round.status === "awarded" ? (
          <span>AWARDED {shortAddress(round.awarded_to, 3).toUpperCase()}</span>
        ) : (
          <span>BUDGET RETURNED</span>
        )}
        {/* An unanswered question is an obligation, not a statistic. It is the
            one thing on this card the buyer can still do something about, so it
            is the one thing given the accent. */}
        {round.questions_unanswered > 0 ? (
          <span className="docket-flag">
            {round.questions_unanswered} UNANSWERED
          </span>
        ) : round.questions > 0 ? (
          <span>
            {round.questions} QUESTION{round.questions === 1 ? "" : "S"} ANSWERED
          </span>
        ) : null}
      </div>
    </Link>
  );
}

/** Score pips: five cells, filled to the score. */
export function Pips({ score, accent }: { score: number; accent?: boolean }) {
  return (
    <span className={`pips ${accent ? "pips-accent" : ""}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((n) => (
        <i key={n} className={n < score ? "on" : ""} />
      ))}
    </span>
  );
}

/**
 * One bid's scores against another's, criterion by criterion.
 *
 * The comparison is the product. A losing bidder reading their own card beside
 * the winner's, with the reason attached to each grade, is the single screen
 * that decides whether they bid into a second round.
 */
export function Scorecard({
  criteria,
  left,
  right,
  leftLabel,
  rightLabel,
  bidCount,
  awardedTo,
}: {
  criteria: Criterion[];
  left: Bid;
  right: Bid | null;
  leftLabel: string;
  rightLabel: string;
  bidCount: number;
  awardedTo?: string;
}) {
  // The column count is a class, never an inline style: an inline
  // grid-template-columns outranks the mobile media query, and the scorecard
  // would stay three columns wide on a phone.
  const cols = right ? "compare" : "solo";
  return (
    <div className="scroller">
      <div className={`score-table ${right ? "" : "score-table-solo"}`}>
        <div className={`score-row score-row-head ${cols}`}>
          <div>Criterion - weight</div>
          <div className="score-cell">{leftLabel}</div>
          {right ? (
            <div className="score-cell" style={{ color: "var(--accent)" }}>
              {rightLabel}
            </div>
          ) : null}
        </div>

        {criteria.map((c) => (
          <div key={c.i} className={`score-row ${cols}`}>
            <div className="score-criterion">
              {c.i + 1} - {c.text}
              <span className="weight-chip">w{c.weight}</span>
            </div>
            <div className="score-cell" data-label={leftLabel}>
              <ScoreCell score={left.scores[c.i]} reason={left.reasons[c.i]} />
            </div>
            {right ? (
              <div className="score-cell" data-label={rightLabel}>
                <ScoreCell score={right.scores[c.i]} reason={right.reasons[c.i]} accent />
              </div>
            ) : null}
          </div>
        ))}

        <div className={`score-row score-row-total ${cols}`}>
          <div className="label" style={{ color: "var(--on-ink-dim)" }}>
            Weighted total
          </div>
          <div className="score-cell" data-label={leftLabel}>
            <span className="total-big">{left.total}</span>{" "}
            <span className="total-note">
              rank {left.rank || " - "} of {bidCount}
            </span>
          </div>
          {right ? (
            <div className="score-cell" data-label={rightLabel}>
              <span className="total-big win">{right.total}</span>{" "}
              <span className="total-note">
                {awardedTo ? `awarded ${shortAddress(awardedTo, 3)}` : `rank ${right.rank || " - "}`}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ScoreCell({
  score,
  reason,
  accent,
}: {
  score: number | undefined;
  reason: string | undefined;
  accent?: boolean;
}) {
  if (score === undefined) {
    return <span style={{ fontSize: 12.5, color: "var(--faint)" }}>not scored</span>;
  }
  return (
    <>
      <div className="score-head">
        <Pips score={score} accent={accent} />
        <span className="score-num">{score}/5</span>
      </div>
      <div className="score-reason">{reason || " - "}</div>
    </>
  );
}
