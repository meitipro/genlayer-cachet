import Link from "next/link";
import type { Metadata } from "next";

import ShaderCard from "@/components/ShaderCard";
import { getTerms } from "@/lib/cachet";
import { LIMITS } from "@/lib/limits";
import { CACHET, IS_LIVE, NETWORK_LABEL, RPC_URL, explorerAddress, HAS_EXPLORER } from "@/lib/chain";
import { formatGen } from "@/lib/format";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The scoring rule, the appeal path, where the score stops, and what a gasless test network establishes.",
};

/** The scoring flow, as steps. It used to be four paragraphs of prose. */
const SCORING_STEPS = [
  {
    title: "A leader proposes",
    body: "One validator reads the revealed proposal against the published criteria and proposes a score from 0 to 5 for each, with a one-line reason pointing at the part of the text it used.",
  },
  {
    title: "Every other validator scores it independently",
    body: "They do not see the leader's answer first. Each grades the same proposal against the same criteria on its own, which is what makes the comparison worth anything.",
  },
  {
    title: "The answers are compared",
    body: "The criterion set must match exactly and each score may differ by at most one step. Agreement keeps the leader's answer; disagreement rotates the leader and tries again with a different model.",
  },
  {
    title: "The contract does the arithmetic",
    body: "Once the per-criterion scores are agreed, the contract multiplies each by the buyer's published weight and adds them up. No model is ever asked for the total.",
  },
];

/** What stops a proposal written to game the scorer. */
const SCORING_DEFENCES = [
  "Every angle bracket in a proposal is neutralised, so it cannot close the tag that holds it and impersonate the criteria.",
  "A proposal that asks for a particular score, claims to be the best, or addresses the scorer directly is scored zero on every criterion.",
  "Claims are treated as claims: an unevidenced claim scores lower than an evidenced one.",
  "Scores must be integers in range, one per criterion, with matching indices. A missing criterion is an error rather than a silent zero.",
];

const SECTIONS = [
  ["scoring", "How scoring reaches agreement"],
  ["appeal", "The appeal path"],
  ["cannot", "Where the score stops"],
  ["failures", "Every way a round can fail"],
  ["studio", "What Studio establishes"],
  ["contract", "The contract surface"],
];

export default async function DocsPage() {
  const terms = await getTerms();

  return (
    <>
      <section className="on-ink section-tight">
        <div className="shell">
          <div className="breadcrumb">How it works</div>
          <h1
            style={{
              fontWeight: 800,
              fontSize: "clamp(30px,4vw,48px)",
              lineHeight: 1.02,
              letterSpacing: "-.035em",
              margin: "0 0 16px",
              maxWidth: "20ch",
            }}
          >
            The parts worth arguing with.
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.55,
              color: "var(--on-ink-dim)",
              maxWidth: "60ch",
              margin: "0 0 26px",
            }}
          >
            A tender that cannot be argued with is not a tender, it is an announcement. This page
            is the scoring rule, the appeal path, and exactly where the score stops and your own
            judgement starts - written down before anyone bids rather than after they lose.
          </p>
          <nav className="row" aria-label="On this page">
            {SECTIONS.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="mono"
                style={{ fontSize: 11.5, letterSpacing: ".06em", color: "var(--on-ink-bright)" }}
              >
                {label} →
              </a>
            ))}
          </nav>
        </div>
      </section>

      {/* scoring */}
      <section id="scoring" className="section-tight on-cream">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">How scoring reaches agreement</div>
            <div className="eyebrow-note">four steps, then arithmetic</div>
          </div>

          <p className="lede" style={{ maxWidth: "62ch", marginBottom: 28 }}>
            Nobody is trusted to hand down a score. Several validators grade the same proposal
            against the same published criteria, separately, and the network keeps the answer
            only if enough of them independently agree on it.
          </p>

          {/* The flow as steps rather than paragraphs, in the same shape as the
              protocol timeline in the dApp so the two read as one idea. */}
          <ol className="how-steps" style={{ marginBottom: 30 }}>
            {SCORING_STEPS.map((s, i) => (
              <li key={s.title} className="how-step">
                <div className="how-rail" aria-hidden="true">
                  <span className="how-icon mono" style={{ fontSize: 12 }}>{i + 1}</span>
                  {i < SCORING_STEPS.length - 1 ? <span className="how-line" /> : null}
                </div>
                <div className="how-body">
                  <div className="how-top">
                    <h3 className="how-title">{s.title}</h3>
                  </div>
                  <p className="how-text">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* What agreement requires. This was three paragraphs and it is four rules. */}
          <div className="panel scroller" style={{ marginBottom: 22 }}>
            <div className="panel-head">
              <span className="label">The agreement rule</span>
              <span className="label">per bid</span>
            </div>
            <table className="rule-table">
              <thead>
                <tr>
                  <th>What is compared</th>
                  <th>May differ by</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>The set of criteria</td>
                  <td><b>Nothing</b></td>
                  <td>A missing criterion is an error, not a silent zero.</td>
                </tr>
                <tr>
                  <td>Each score</td>
                  <td><b>One step</b></td>
                  <td>Two honest readers can land a point apart. Demanding an exact match would stall on the rounding of judgment.</td>
                </tr>
                <tr>
                  <td>The written reasons</td>
                  <td><b>Not compared</b></td>
                  <td>Two nodes word the same observation differently. Putting free prose under an equality check is the fastest way to make scoring never settle.</td>
                </tr>
                <tr>
                  <td>The weighted total</td>
                  <td><b>Never proposed</b></td>
                  <td>Weights never enter the prompt. The contract multiplies and adds the agreed scores in ordinary deterministic code.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-auto-290">
            <div className="panel">
              <div className="panel-head">
                <span className="label">When the network cannot agree</span>
              </div>
              <div className="panel-body">
                <p className="how-text">
                  The bid is left unscored and the round pauses rather than awarding around it.
                  Awarding while one bid is unscored would mean somebody won by being the only
                  bid the network could read, so the contract refuses.
                </p>
                <p className="how-text" style={{ marginTop: 12 }}>
                  Two validators never agree on a malformed answer either. Agreeing would write
                  &ldquo;the scoring failed&rdquo; into a tender as though it were a finding;
                  disagreeing rotates the leader and tries again with a different model.
                </p>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="label">Against a proposal written to game it</span>
              </div>
              <div className="panel-body">
                <ul className="how-rules">
                  {SCORING_DEFENCES.map((d) => (
                    <li key={d}>
                      <svg width="15" height="15" viewBox="0 0 21 21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 11l4 4 9-9" />
                      </svg>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* clarifications */}
      <section id="questions" className="section-tight on-band">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">Asking what a criterion means</div>
            <div className="eyebrow-note">public, on chain, before anyone bids</div>
          </div>
          <div className="prose" style={{ maxWidth: "72ch" }}>
            <p>
              A criterion can be frozen and still be ambiguous. When it is, every bidder resolves
              the ambiguity privately and differently, and the scores end up measuring who guessed
              the buyer&rsquo;s intent rather than who is best placed to do the work. That is the
              opposite of what this contract exists to measure.
            </p>
            <p>
              So the clarification happens in the open. Anyone may ask - you do not need to have
              sealed a bid, because needing to pay a deposit to find out what a criterion means
              would defeat the point, and the answer is public either way. The buyer answers once,
              and everyone reads the same answer with the same timestamp. A private word between a
              buyer and one bidder would be worth more than any criterion on the page.
            </p>
            <p>
              <strong>Questions close when the commit window closes</strong>, not when the reveal
              window does. An answer arriving after commitments were sealed would be information
              only the bidders who held back could act on: the ones who already committed cannot
              rewrite their proposal. Closing questions with commitments removes the reward for
              waiting.
            </p>
            <p>
              <strong>An answer is written once and cannot be revised.</strong> Moving the
              goalposts is bad; moving them with no record that they moved is worse, and the
              record is the product.
            </p>
            <p>
              <strong>An answer does not change what is scored.</strong> The network is given the
              frozen criteria and nothing else, so a clarification helps a bidder write to the
              standard rather than altering the standard. If an answer would genuinely change the
              standard, the honest move is to decline the round and publish a better one - which
              costs the buyer the budget back and nothing else.
            </p>
            <p>
              Capped at {LIMITS.questionsMax} questions per round and {LIMITS.asksPerAddress} per
              address. The cap is not about storage: the buyer&rsquo;s attention is the scarce
              resource, and one address flooding the queue spends every other bidder&rsquo;s share
              of it.
            </p>
          </div>
        </div>
      </section>

      {/* appeal */}
      <section id="appeal" className="section-tight on-cream">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">The appeal path</div>
            <div className="eyebrow-note">
              {terms ? `bond ${formatGen(terms.appeal_bond, 2)} GEN` : "bond set by the contract"}
            </div>
          </div>
          <div className="prose" style={{ maxWidth: "72ch" }}>
            <p>
              <strong>When an appeal makes sense.</strong> A score on a specific criterion looks
              wrong against your own proposal text. Both are public after the reveal, so the claim
              is checkable by anyone rather than a matter of opinion.
            </p>
            <p>
              <strong>What it costs.</strong> The bond{terms ? " above" : " the contract holds"},
              and the award is held while the appeal is open. A tender that paid out during a live scoring appeal would make the
              appeal meaningless.
            </p>
            <p>
              <strong>What happens.</strong> The bid is re-scored against the same proposal, with
              your argument attached as a claim <em>about</em> that text. If the argument points
              at wording that is genuinely in the proposal, that wording is taken into account. If
              it asserts anything the proposal does not say, it is ignored - an appeal cannot
              become a second, unsealed bid.
            </p>
            <p>
              <strong>How it settles.</strong> If the re-score raises the weighted total, the
              appeal is upheld and the bond comes back. If the total holds or falls, the bond
              pays for the re-scoring. It has to be an improvement rather than any movement,
              because the agreement rule treats a one-step difference on a criterion as noise,
              and a bond that noise alone could recover would not be a bond. Either way the new
              scorecard replaces the old one and is marked as re-scored, with the previous total
              kept beside it.
            </p>
            <p>
              <strong>Who can resolve it.</strong> Anyone. An unresolved appeal blocks the whole
              round, so nobody - least of all the buyer waiting to award - should need the
              appellant&rsquo;s cooperation to move it.
            </p>
            <p>
              <strong>The deadline.</strong> An appeal can be opened at any time while the round
              is still open - it is bounded by settlement, not by the decision window. Scoring has
              no deadline, so a bid can be scored after that window has already passed, and
              bounding appeals by it would leave that bidder no window at all on a scorecard they
              could not have seen earlier. Once a round is awarded or declined, nothing can be
              appealed.
            </p>
            <p className="mono" style={{ fontSize: 12.5, color: "var(--faint)" }}>
              Separately from all of this, GenLayer&rsquo;s own protocol appeal exists: anyone can
              challenge an accepted transaction during its finality window by posting the protocol
              bond, and each round roughly doubles the jury. That is a challenge to the
              consensus; the appeal above is a challenge to the score.
            </p>
          </div>
        </div>
      </section>

      {/* cannot */}
      <section id="cannot" className="section-tight on-band">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">Where the score stops</div>
            <div className="eyebrow-note">read before you escrow anything</div>
          </div>
          <div className="grid grid-auto-290">
            {[
              [
                "The score measures the proposal, not the supplier",
                "What is graded is the submitted text, against your criteria. So a well written proposal from a weak supplier will outscore a badly written one from a strong supplier. Criteria demanding verifiable, named references pull the score back towards evidence, and that is the lever you have.",
              ],
              [
                "A claim is scored as a claim",
                "No page is fetched during a round, by design: a scoring pass that reached out to the web would give every validator a different document and agreement would never settle. If a bidder names three references, the network scores that three were named. Checking them is your step, before you award.",
              ],
              [
                "Sealing raises the price of coordination",
                "Each commitment is a hash bound to its own bidder's address, so nobody can see a rival's number before the window closes, and nobody can submit under another's name. Bidders determined to agree in advance still can, and their proposals are scored exactly as faithfully as everyone else's.",
              ],
              [
                "Published criteria are final, on purpose",
                "There is no method that edits criteria or weights, and no owner override - that immutability is the guarantee the whole product rests on. It applies to typos too. The remedy is to decline the round, which returns every deposit and the budget, and publish the corrected standard.",
              ],
              [
                "A result is reported as agreed, never counted",
                "Validators re-run the scoring independently and the network settles on the answer they agree about. A contract cannot read its own vote tally, so these screens say a result was agreed rather than 'five of five' - a number no code here is in a position to print.",
              ],
              [
                "The settlement path around this is yours",
                "GenLayer supports an agreed settlement workflow, and this contract gives you a record every party can check line by line. Turning that record into a binding obligation is contract law, not consensus: the agreements, the jurisdiction and the escalation path stay where they were.",
              ],
            ].map(([title, body], i) => (
              <ShaderCard key={title} title={title} body={body} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* failure table */}
      <section id="failures" className="section-tight on-cream">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">Every way a round can fail</div>
            <div className="eyebrow-note">and what happens</div>
          </div>
          <div className="panel scroller">
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead>
                <tr>
                  <th className="label" style={{ textAlign: "left", padding: "12px 22px", borderBottom: "1px solid var(--line)" }}>
                    Failure
                  </th>
                  <th className="label" style={{ textAlign: "left", padding: "12px 22px", borderBottom: "1px solid var(--line)" }}>
                    Designed behaviour
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "A bidder never reveals",
                    "The commitment expires unscored and the entry deposit is forfeited, which is what pays for scoring the bids that did arrive. Expiry is a real state change anyone can trigger, not a status inferred from a clock.",
                  ],
                  [
                    "A reveal does not match the hash",
                    "Refused immediately, before any scoring runs, and nothing is stored. The bidder can correct the text and reveal again while the window is open; if they never produce matching bytes, the bid expires.",
                  ],
                  [
                    "A reveal arrives during the commit window",
                    "Refused. Allowing one would let a later bidder read an opened proposal and price against it, which is the exact failure sealed bidding exists to prevent.",
                  ],
                  [
                    "An ineligible bidder tries to bid",
                    "Refused on the deterministic eligibility check, with no scoring cost. Eligibility rules are checked in code; anything needing judgment belongs in the criteria.",
                  ],
                  [
                    "Every bid scores poorly",
                    "The buyer may decline and the budget returns. That possibility is stated in the tender before bidding opens, and a buyer cannot decline before every revealed bid has been scored.",
                  ],
                  [
                    "One bid cannot be scored",
                    "The round pauses. Awarding around an unscored bid would mean winning by being the only bid the network could read.",
                  ],
                  [
                    "Two bids tie on the total",
                    "Broken by the criterion the buyer marked primary at publication, and only then by the order the commitments arrived. Never a coin flip and never list order.",
                  ],
                  [
                    "The buyer tries to change the criteria mid-round",
                    "Impossible. There is no method in the contract that edits them.",
                  ],
                  [
                    "The buyer does nothing at all",
                    "After the decision window, awarding is permissionless. If no bid was ever scored, anyone can close the round and return the budget. An escrowed budget cannot be stranded by a buyer who dislikes the result.",
                  ],
                ].map(([f, b]) => (
                  <tr key={f}>
                    <td
                      style={{
                        padding: "14px 22px",
                        borderBottom: "1px solid var(--line-softer)",
                        fontSize: 14,
                        fontWeight: 600,
                        lineHeight: 1.4,
                        width: "34%",
                        verticalAlign: "top",
                      }}
                    >
                      {f}
                    </td>
                    <td
                      style={{
                        padding: "14px 22px",
                        borderBottom: "1px solid var(--line-softer)",
                        fontSize: 13.5,
                        color: "var(--muted)",
                        lineHeight: 1.55,
                      }}
                    >
                      {b}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* studio */}
      <section id="studio" className="section-tight on-band">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">What Studio establishes</div>
            <div className="eyebrow-note">{NETWORK_LABEL}</div>
          </div>
          <div className="prose" style={{ maxWidth: "72ch" }}>
            <p>
              A full round with several bidders runs on Studio end to end: commit and reveal,
              escrow, scoring, appeal and award. Every rule on this page is exercised there
              against real transactions. What Studio does not settle is money. Read the list
              below before taking a balance off this network: every item on it is a property of
              the test network rather than of the contract, and each one says which.
            </p>
            <ul>
              <li>
                <strong>A payout does not land here.</strong> When a round is awarded, the
                contract emits the transfer correctly - the settlement receipt carries the right
                recipient and the right amount, and the contract is debited by exactly that - but
                Studio&rsquo;s ledger does not apply an emitted transfer to an ordinary account.
                So a winner on this network will see the award recorded and their balance
                unchanged. That is the test network, not the contract, and it is the single most
                important thing to re-verify on a live one before anyone escrows real money.
              </li>
              <li>
                <strong>Studio is gasless.</strong> A receipt from here says nothing about live
                fees. One scoring pass runs per revealed bid, so cost scales with bidder count
                rather than with budget - and the cost of scoring twenty long proposals is a
                measurement to take on a live network too.
              </li>
              <li>
                <strong>A pre-flight balance guard is switched off here.</strong> Studio has
                answered 0 to a balance query for accounts whose payable calls then succeeded, so
                refusing a write on a zero balance would refuse everything. The transaction is
                the judge.
              </li>
              <li>
                <strong>Chain-layer and ghost-contract behaviour is not fully modelled</strong>,
                and the validator set is not the live one.
              </li>
              <li>
                <strong>Anything money-critical is validated on a live network before launch.</strong>{" "}
                That is a blocker, not a nice-to-have.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* contract */}
      <section id="contract" className="section-tight on-cream">
        <div className="shell">
          <div className="eyebrow-row">
            <div className="eyebrow">The contract surface</div>
            <div className="eyebrow-note">
              {IS_LIVE ? "deployed" : "not deployed on this network"}
            </div>
          </div>

          {IS_LIVE ? (
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-body">
                <div className="label" style={{ marginBottom: 8 }}>
                  Address
                </div>
                <p className="hash" style={{ fontSize: 13.5, color: "var(--ink)" }}>
                  {HAS_EXPLORER ? (
                    <a href={explorerAddress(CACHET)} target="_blank" rel="noreferrer noopener">
                      {CACHET}
                    </a>
                  ) : (
                    CACHET
                  )}
                </p>
                <p className="hash" style={{ marginTop: 10 }}>
                  {RPC_URL}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid grid-auto-240">
            {[
              ["check_criteria", "Ask the network whether a criteria set can be scored from proposal text. No money attached, and the verdict is stored on chain."],
              ["open_round", "Payable. Freezes criteria and weights, escrows the budget. Refuses any set that has not passed the check."],
              ["commit", "Payable. Takes a sha256 digest and the entry deposit. Refuses a closed window, a malformed digest, a second live bid from the same address."],
              ["amend", "Bidder only, while the commit window is open. Replaces your own digest. The count and the moment are published."],
              ["withdraw", "Bidder only, while the commit window is open. Returns the deposit, frees the slot, and lets you seal again."],
              ["reveal", "Deterministic. Checks the windows, then the lengths, then the digest. Eligibility is NOT re-checked here: it is settled once at commit, so winning some other tender in between can never strand a bid that is already sealed."],
              ["score", "Permissionless. Grades one revealed bid against the frozen criteria and sums the total in code."],
              ["appeal_score", "Payable, bidder only, once per bid. Holds the award while it is open."],
              ["resolve_appeal", "Permissionless. Re-scores with the argument attached as a claim about the text."],
              ["award", "Buyer first, then permissionless. Refuses while any revealed bid is unscored, while any appeal is open, and until an hour has passed since the last score - so a buyer cannot score and award in the same breath and leave nobody time to contest."],
              ["decline", "Buyer only, after reveals close and before the decision deadline, and not until the appeal window on the last score has closed. Returns the budget and every deposit a bidder who turned up had paid."],
              ["expire", "Permissionless after the decision deadline, on a round that cannot be awarded. Refuses while an appeal is open, because resolving one is permissionless and an unresolved appeal is not a dead end. Returns the budget."],
              ["claim", "Pull a deposit or an upheld appeal bond. Pull rather than push, so one failing transfer cannot hold up a settlement. A withdrawn bid can claim immediately."],
              ["sweep", "Permissionless. Marks commitments that were never opened as expired."],
            ].map(([name, body]) => (
              <div key={name} className="step">
                <div className="mono" style={{ fontSize: 13, color: "var(--accent)", marginBottom: 10 }}>
                  {name}
                </div>
                <div className="step-body">{body}</div>
              </div>
            ))}
          </div>

          <div className="note" style={{ marginTop: 22 }}>
            <strong>There is no view that hashes a proposal for you.</strong> Calling one would
            put the text on the wire during the commit window, which is exactly what a sealed
            tender exists to prevent. Hashing happens in your browser, on{" "}
            <Link href="/publish">the publish screen</Link> and on every bid screen, and only the
            digest is ever submitted.
          </div>
        </div>
      </section>
    </>
  );
}
