import type { Metadata } from "next";

import ViewHead from "@/components/app/ViewHead";
import CopyAddress from "@/components/app/CopyAddress";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getTerms } from "@/lib/cachet";
import { CACHET, HAS_EXPLORER, NETWORK_LABEL, explorerAddress } from "@/lib/chain";
import { formatGen } from "@/lib/format";

export const revalidate = 300;

export const metadata: Metadata = { title: "The contract" };

/**
 * The handoff's Contract pane.
 *
 * The design draws a method browser with "Send Transaction" buttons beside
 * every write, and that is where this deviates on purpose. A method browser
 * that fires arbitrary writes from a form is a way to lose a deposit to a
 * mistyped argument: `commit_bid` with the wrong hash cannot be undone, and
 * `publish_tender` escrows a budget on the spot. Every one of these has a
 * screen built around it that explains what it costs and refuses the
 * combinations the contract would refuse anyway.
 *
 * So this lists the surface honestly and links each method to the screen that
 * drives it. The method names, arguments and one-line notes are the real ones,
 * read from the contract source rather than the mockup's placeholders.
 */

type Method = { name: string; args: string; note: string; href?: string };

const WRITES: Method[] = [
  {
    name: "open_round",
    args: "title, summary, criteria, weights, primary, windows, eligibility",
    note: "Escrows the budget and freezes the criteria. There is no method that edits either afterwards.",
    href: "/publish",
  },
  {
    name: "check_criteria",
    args: "criteria",
    note: "The scorability gate. Final in both directions, so criteria cannot be re-asked until they pass.",
    href: "/publish",
  },
  {
    name: "commit",
    args: "round_id, commitment",
    note: "Stores a sha256 that binds your own address. Costs the entry deposit.",
  },
  {
    name: "amend",
    args: "round_id, bid_index, commitment",
    note: "Replaces a sealed digest while the commit window is open.",
  },
  {
    name: "withdraw",
    args: "round_id, bid_index",
    note: "Cancels a sealed bid before the window closes and returns the deposit.",
  },
  {
    name: "reveal",
    args: "round_id, bid_index, salt, proposal",
    note: "Refused unless the hash of address, proposal and salt matches what was sealed. Eligibility is not re-checked, so a bid sealed in good faith can always be opened.",
  },
  {
    name: "score",
    args: "round_id, bid_index",
    note: "Permissionless. Runs the comparative consensus that grades one bid.",
  },
  {
    name: "appeal_score",
    args: "round_id, bid_index, argument",
    note: "Once per bid, by its own bidder, against a bond forfeited unless the re-score raises the total.",
    href: "/rounds",
  },
  {
    name: "resolve_appeal",
    args: "round_id, bid_index",
    note: "Permissionless. Re-scores the bid with the argument in front of the network.",
  },
  { name: "ask", args: "round_id, question", note: "Open to any address. Closes with the commit window." },
  { name: "answer", args: "round_id, question_index, reply", note: "Buyer only, once, and closes with the commit window." },
  {
    name: "award",
    args: "round_id",
    note: "Buyer first, then anyone once the decision window has passed. Refused until an hour after the last score, so the appeal is reachable rather than merely documented.",
  },
  {
    name: "decline",
    args: "round_id, why",
    note: "Returns the budget, and the deposit of every bidder who turned up. A commitment nobody ever opened still forfeits. Never charges the fee. Waits out the same appeal window an award does: a score lands on the bidder record whether the round paid anybody or not.",
  },
  {
    name: "expire",
    args: "round_id",
    note: "Abandons a round that cannot be awarded, so escrow is never stranded. Refuses while an appeal is open: resolving one is permissionless, so that is not a dead end.",
  },
  { name: "sweep", args: "round_id", note: "Marks bids that were never revealed, so the record matches reality." },
  { name: "claim", args: "round_id, bid_index", note: "Each bidder pulls what they are owed. Nothing is pushed.", href: "/rounds" },
  {
    name: "collect_forfeits",
    args: "round_id",
    note: "Permissionless. Sends the deposits of bidders who never revealed to the treasury, which is what pays for scoring the bids that did arrive.",
  },
  {
    name: "transfer_ownership",
    args: "new_owner",
    note: "Owner only. Refuses the zero address, so the role cannot be dropped by accident.",
  },
  { name: "set_terms", args: "fee_bps, entry_deposit, appeal_bond", note: "Owner only, and it never reaches a round that already exists." },
  { name: "set_treasury", args: "treasury", note: "Owner only. Where the award fee is sent." },
];

const READS: Method[] = [
  { name: "terms", args: "", note: "Fees, deposits and every published limit." },
  { name: "stats", args: "", note: "Running totals: rounds, bids, escrow, payouts." },
  {
    name: "check",
    args: "digest",
    note: "The stored scorability verdict for a criteria set. Read before publishing, so wording already judged is never re-asked.",
    href: "/publish",
  },
  { name: "rounds_page", args: "offset, limit", note: "A page of rounds, newest first.", href: "/rounds" },
  { name: "round", args: "round_id", note: "One round with its frozen criteria and weights." },
  { name: "bids", args: "round_id", note: "Every scorecard, proposals cut to a preview." },
  { name: "bid", args: "round_id, bid_index", note: "One bid with its proposal in full." },
  { name: "questions", args: "round_id", note: "Every clarification, asked and answered." },
  { name: "bidder", args: "address", note: "What an address entered, opened, scored and won.", href: "/my-bids" },
  { name: "buyer", args: "address", note: "What an address published, awarded and declined." },
];

export default async function ContractPage() {
  const terms = await getTerms();

  if (!CONFIGURED) return <NotConfigured />;

  return (
    <div className="shell view-pane">
      <ViewHead
        title="The contract"
        sub="Every method this app can call, and what each one costs."
      />

      <section className="panel">
        <div className="panel-head">
          <span className="label">Contract</span>
          <span className="label">GENVM PYTHON</span>
        </div>
        <div className="panel-body">
          <div className="contract-addr">
            <code className="mono">{CACHET}</code>
            <div className="btn-row">
              <CopyAddress value={CACHET} />
              {HAS_EXPLORER ? (
                <a
                  className="btn btn-ghost btn-small"
                  href={explorerAddress(CACHET)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open in the explorer
                </a>
              ) : null}
            </div>
          </div>
          <p className="panel-note">
            On {NETWORK_LABEL}.{" "}
            {terms ? (
              <>
                Source version <b>{terms.version}</b>. An entry deposit is{" "}
                {formatGen(terms.entry_deposit)} GEN, an appeal bond is{" "}
                {formatGen(terms.appeal_bond)} GEN, and the award fee is {terms.fee_bps / 100}% -
                all read from the contract, not from this page. Run{" "}
                <code className="mono">npm run verify</code> to check this deployment against
                the source in the repo.
              </>
            ) : (
              <>The terms could not be read just now.</>
            )}
          </p>
        </div>
      </section>

      <div className="view-cols">
        <MethodList title="Write methods" kind="WRITE" methods={WRITES} />
        <MethodList title="Read methods" kind="READ" methods={READS} />
      </div>
    </div>
  );
}

function MethodList({ title, kind, methods }: { title: string; kind: string; methods: Method[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="label">{title}</span>
        <span className="label">{methods.length}</span>
      </div>
      <div className="panel-body">
        <ul className="method-list">
          {methods.map((m) => (
            <li key={m.name}>
              <div className="method-top">
                <code className="mono method-name">{m.name}</code>
                <span className={`method-kind kind-${kind.toLowerCase()}`}>{kind}</span>
              </div>
              {m.args ? <code className="mono method-args">({m.args})</code> : null}
              <p className="method-note">{m.note}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
