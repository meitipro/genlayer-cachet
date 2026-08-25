import Link from "next/link";
import type { Metadata } from "next";

import Stat from "@/components/app/Stat";
import ViewHead from "@/components/app/ViewHead";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getRounds, getStats } from "@/lib/cachet";
import { formatGen } from "@/lib/format";
import { phaseOf } from "@/lib/format";

export const revalidate = 15;

export const metadata: Metadata = { title: "Overview" };

/**
 * The handoff's Overview pane.
 *
 * Four figures, then the work waiting on the reader. The design also draws two
 * charts - a twelve-month escrow line and an award-rate donut - and neither is
 * built, because neither can be: the contract keeps running totals, not a
 * history of them, so a twelve-month line would have to be invented. The award
 * rate IS derivable and is shown as the plain ratio it is.
 *
 * "Needs you" is the part of this pane that earns its place. The design lists
 * three fixed rows; here it is whatever the chain says is actually waiting -
 * rounds still taking bids, rounds in their reveal window, and rounds a bid
 * has been scored on.
 */
export default async function OverviewPage() {
  const [stats, page] = await Promise.all([getStats(), getRounds(0, 24)]);

  if (!CONFIGURED) return <NotConfigured />;
  if (!stats) return <Unreachable what="the overview" />;

  const now = Date.now();
  const rounds = page?.rounds ?? [];
  const open = rounds.filter((r) => phaseOf(r, now) === "commit");
  const reveal = rounds.filter((r) => phaseOf(r, now) === "reveal");

  const settled = stats.awarded + stats.declined;
  const awardRate = settled > 0 ? Math.round((stats.awarded / settled) * 100) : null;

  return (
    <div className="shell view-pane">
      <ViewHead
        title="Overview"
        sub="What this contract holds, and what is waiting on you."
      />

      <div className="grid grid-auto-240 stat-grid">
        <Stat label="ESCROWED" value={formatGen(stats.escrowed)} unit="GEN" />
        <Stat label="ROUNDS SETTLED" value={settled.toLocaleString("en-US")} />
        <Stat label="BIDS SCORED" value={stats.bids_scored.toLocaleString("en-US")} />
        <Stat label="APPEALS OPEN" value={(stats.appeals - stats.appeals_upheld).toLocaleString("en-US")} />
      </div>

      <div className="view-cols">
        <section className="panel">
          <div className="panel-head">
            <span className="label">Award rate</span>
            <span className="label">ALL TIME</span>
          </div>
          <div className="panel-body">
            {awardRate === null ? (
              <p className="empty-line">
                No round has settled yet, so there is no rate to report.
              </p>
            ) : (
              <>
                <div className="ratio-bar" aria-hidden="true">
                  <span className="ratio-fill" style={{ width: `${awardRate}%` }} />
                </div>
                <div className="ratio-legend">
                  <span>
                    <b>{stats.awarded}</b> awarded
                  </span>
                  <span>
                    <b>{stats.declined}</b> declined
                  </span>
                </div>
                <p className="panel-note">
                  A declined round returns every deposit and the whole budget. Publishing a
                  tender is not a promise to award it, and the docket shows both outcomes so a
                  buyer&rsquo;s history is a signal a bidder can read.
                </p>
              </>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="label">Needs you</span>
            <span className="label">
              {open.length + reveal.length} {open.length + reveal.length === 1 ? "ITEM" : "ITEMS"}
            </span>
          </div>
          <div className="panel-body">
            {open.length + reveal.length === 0 ? (
              <p className="empty-line">
                Nothing is open. When a round starts taking bids it appears here.
              </p>
            ) : (
              <ul className="needs-list">
                {open.map((r) => (
                  <li key={`c${r.id}`}>
                    <span className="needs-id mono">R{r.id}</span>
                    <span className="needs-what">Taking sealed bids</span>
                    <Link href={`/bid/${r.id}`} className="btn btn-ghost btn-small">
                      Seal bid
                    </Link>
                  </li>
                ))}
                {reveal.map((r) => (
                  <li key={`v${r.id}`}>
                    <span className="needs-id mono">R{r.id}</span>
                    <span className="needs-what">Reveal window is open</span>
                    <Link href={`/bid/${r.id}`} className="btn btn-ghost btn-small">
                      Reveal
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
