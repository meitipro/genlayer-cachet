import Link from "next/link";
import type { Metadata } from "next";

import ViewHead from "@/components/app/ViewHead";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getRounds } from "@/lib/cachet";
import { formatDate } from "@/lib/format";

export const revalidate = 15;

export const metadata: Metadata = { title: "Scorecards" };

/**
 * The handoff's Scorecards pane.
 *
 * The design draws ONE scorecard - round 28, a criterion-by-criterion
 * comparison against the winning bid, the full field ranked, and an appeal
 * form. All of that already exists here, per round, at `/r/[id]` and
 * `/r/[id]/b/[bid]`, built against the real criteria rather than four fixed
 * rows. Rebuilding it inside this pane would mean two implementations of the
 * one screen the product is judged on.
 *
 * So this is the index the design implies but does not draw: every round that
 * has scores to read, newest first, each opening the scorecard it belongs to.
 */
export default async function ScorecardsPage() {
  const page = await getRounds(0, 24);

  if (!CONFIGURED) return <NotConfigured />;
  if (!page) return <Unreachable what="the scorecards" />;

  // A round has something to read the moment any bid on it has been scored.
  const scored = page.rounds.filter((r) => r.scored > 0);

  return (
    <div className="shell view-pane">
      <ViewHead
        title="Scorecards"
        sub="Every round with grades on the record, and the reasons behind them."
        actionLabel="Find a tender"
        actionHref="/rounds"
      />

      <section className="panel">
        <div className="panel-head">
          <span className="label">Scored rounds</span>
          <span className="label">{scored.length}</span>
        </div>
        <div className="panel-body">
          {scored.length === 0 ? (
            <p className="empty-line">
              Nothing has been scored yet. A scorecard appears the moment the network agrees on
              a grade for any revealed bid, and every bidder on the round gets the same page.
            </p>
          ) : (
            <ul className="mine-list">
              {scored.map((r) => (
                <li key={r.id}>
                  <span className="mine-id mono">R{r.id}</span>
                  <span className="mine-title">{r.title}</span>
                  <span className="mine-status">
                    {r.scored} of {r.bids} SCORED
                  </span>
                  <span className="mono escrow-amount">{formatDate(r.decide_closes)}</span>
                  <Link href={`/r/${r.id}`} className="btn btn-ghost btn-small">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="panel-note">
            Every bidder receives the same page, the winner and the losers alike: a grade per
            published criterion with the reason the network wrote for it, and the criteria as
            they were frozen before any bid was opened.
          </p>
        </div>
      </section>
    </div>
  );
}
