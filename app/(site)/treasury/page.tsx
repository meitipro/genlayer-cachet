import type { Metadata } from "next";

import Stat from "@/components/app/Stat";
import ViewHead from "@/components/app/ViewHead";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getRounds, getStats, getTerms } from "@/lib/cachet";
import { formatGen, phaseOf } from "@/lib/format";

export const revalidate = 15;

export const metadata: Metadata = { title: "Treasury" };

/**
 * The handoff's Treasury pane.
 *
 * Its four figures map onto the contract's own totals, with one correction.
 * The design shows AVAILABLE and LOCKED IN ESCROW as different numbers -
 * 83,000 both times, which is the mockup being a mockup. There is no
 * "available" pool here: a budget is escrowed at publication and leaves only
 * on award or decline, so the contract holds exactly what is locked. Printing
 * the same figure under two labels would invent a distinction the code does
 * not have, so the second card reports the fee take instead, which is real.
 *
 * The design's "Activity, last 30 days" ledger is not built. Every row in it
 * is an event - award released, escrow returned, tender published - and this
 * contract keeps state rather than a log: there is no view that returns what
 * happened and when. Escrow by round IS derivable and is here.
 */
export default async function TreasuryPage() {
  const [stats, page, terms] = await Promise.all([getStats(), getRounds(0, 24), getTerms()]);

  if (!CONFIGURED) return <NotConfigured />;
  if (!stats) return <Unreachable what="the treasury" />;

  const now = Date.now();
  // Escrow is held while a round is unsettled, which is exactly the rounds
  // that are not awarded or declined.
  //
  // `page` is null when the docket could not be read, and that is NOT the same
  // as no round holding a budget. Flattening the two put "No round is holding
  // a budget" directly beneath a non-zero escrow figure, which is the page
  // contradicting itself in the one place it exists to be trusted.
  const roundsUnread = page === null;
  const holding = roundsUnread ? [] : page.rounds.filter((r) => r.status === "open");

  return (
    <div className="shell view-pane">
      <ViewHead title="Treasury" sub="What the contract holds, and which round it is held against." />

      <div className="grid grid-auto-240 stat-grid">
        <Stat label="LOCKED IN ESCROW" value={formatGen(stats.escrowed)} unit="GEN" />
        <Stat label="PAID OUT, ALL TIME" value={formatGen(stats.paid)} unit="GEN" />
        <Stat label="FEES TAKEN" value={formatGen(stats.fees)} unit="GEN" />
        <Stat
          label="APPEAL BOND"
          value={terms ? formatGen(terms.appeal_bond) : "not read"}
          unit={terms ? "GEN" : undefined}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <span className="label">Escrow by round</span>
          <span className="label">LOCKED UNTIL SETTLEMENT</span>
        </div>
        <div className="panel-body">
          {roundsUnread ? (
            <p className="empty-line">
              The docket could not be read just now, so which rounds are holding the figure above
              cannot be shown. The total itself came from the contract and is current.
            </p>
          ) : holding.length === 0 ? (
            <p className="empty-line">
              No round is holding a budget. Escrow appears here from the moment a tender is
              published until it is awarded or declined.
            </p>
          ) : (
            <ul className="escrow-list">
              {holding.map((r) => {
                const phase = phaseOf(r, now);
                return (
                  <li key={r.id}>
                    <span className="escrow-id mono">R{r.id}</span>
                    <span className="escrow-title">{r.title}</span>
                    <span className="escrow-amount mono">{formatGen(r.budget)} GEN</span>
                    <span className={`escrow-phase phase-${phase}`}>{phase.toUpperCase()}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="panel-note">
            A budget is escrowed at publication and can leave in exactly two directions: to the
            winner on award, or back to the buyer on decline. There is no method that withdraws
            it any other way, which is what makes a published tender worth bidding into.
          </p>
        </div>
      </section>
    </div>
  );
}
