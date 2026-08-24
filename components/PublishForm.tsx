"use client";

import { useCallback, useMemo, useState } from "react";

import {
  CONTRACT,
  CONTRACT_CONFIGURED,
  executionOf,
  readableError,
  refusalOf,
  useWallet,
  waitAccepted,
  walletClient,
} from "@/components/wallet";
import { formatGen, humanError } from "@/lib/format";
import { LIMITS } from "@/lib/limits";
import { criteriaDigest } from "@/lib/seal";
import type { Terms } from "@/lib/types";

/**
 * Write a tender that can be scored.
 *
 * Publishing is two transactions on purpose, and the split is the interesting
 * part of this screen.
 *
 * `check_criteria` asks the network whether each criterion can be scored from
 * proposal text at all. It costs nothing and carries no budget, so a buyer
 * sees the verdict before committing money, and the verdict lands on chain
 * where bidders can read it too.
 *
 * `open_round` is then fully deterministic: it escrows the budget and refuses
 * any criteria set whose digest has no stored passing verdict. That ordering
 * is what keeps the freezing of the criteria - the guarantee the whole product
 * rests on - from depending on a model being available at the moment somebody
 * clicks publish.
 */

type Criterion = { text: string; weight: number };

const BLANK: Criterion = { text: "", weight: 1 };

function localIso(daysFromNow: number) {
  const at = new Date(Date.now() + daysFromNow * 86_400_000);
  at.setUTCSeconds(0, 0);
  return at.toISOString().slice(0, 16);
}

type Verdict = {
  scorable: boolean;
  flagged: number[];
  reasons: string[];
  criteria: string[];
};

/**
 * `terms` may be null when the contract is unreachable. The form still works:
 * the limits it validates against are the contract's compile-time constants
 * (lib/limits.ts), and the only thing lost is the current fee and deposit -
 * which are read from the chain rather than guessed, because a stale copy of a
 * number that decides what a bidder pays would be a lie.
 */
export default function PublishForm({ terms }: { terms: Terms | null }) {
  const { address, chainOk, busy, error, connect, network } = useWallet();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [criteria, setCriteria] = useState<Criterion[]>([{ ...BLANK, weight: 3 }, { ...BLANK }]);
  const [primary, setPrimary] = useState(0);
  const [budget, setBudget] = useState("");
  const [maxBids, setMaxBids] = useState("12");
  const [eligibility, setEligibility] = useState("");
  const [commitAt, setCommitAt] = useState(localIso(7));
  const [revealAt, setRevealAt] = useState(localIso(14));
  const [decideAt, setDecideAt] = useState(localIso(21));

  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  /** True when the verdict shown was already on chain rather than just asked for. */
  const [alreadyJudged, setAlreadyJudged] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [roundId, setRoundId] = useState<number | null>(null);
  /**
   * The write landed. Separate from knowing WHICH round it made.
   *
   * The id comes from a second read, and that read can be rate limited even
   * though the publish succeeded. Driving the success panel off the id alone
   * meant a busy RPC turned a completed, escrowed publish into a failure
   * message - and the one thing a buyer must not do after that message is
   * publish again.
   */
  const [published, setPublished] = useState(false);

  const texts = useMemo(
    () => criteria.map((c) => c.text.split(/\s+/).filter(Boolean).join(" ").trim()).filter(Boolean),
    [criteria],
  );

  // Any edit to the criteria invalidates the verdict: it was about a different
  // set of words, and the contract keys it by digest anyway.
  const setCriterion = useCallback((i: number, patch: Partial<Criterion>) => {
    setVerdict(null);
    setAlreadyJudged(false);
    setCriteria((rows) => rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }, []);

  const addCriterion = () => {
    setVerdict(null);
    setAlreadyJudged(false);
    setCriteria((rows) => (rows.length >= LIMITS.criteriaMax ? rows : [...rows, { ...BLANK }]));
  };

  const removeCriterion = (i: number) => {
    setVerdict(null);
    setAlreadyJudged(false);
    setCriteria((rows) => (rows.length <= 1 ? rows : rows.filter((_, n) => n !== i)));
    setPrimary((p) => (p >= i && p > 0 ? p - 1 : p));
  };

  const windowsOk = useMemo(() => {
    const now = Date.now();
    const c = Date.parse(`${commitAt}:00Z`);
    const r = Date.parse(`${revealAt}:00Z`);
    const d = Date.parse(`${decideAt}:00Z`);
    return Number.isFinite(c) && Number.isFinite(r) && Number.isFinite(d) && now < c && c < r && r < d;
  }, [commitAt, revealAt, decideAt]);

  /**
   * The budget in wei, or null if the field cannot become one.
   *
   * Computed the same way the submit path computes it, so the form cannot pass
   * a value the send would then choke on. Two cases the naive `Number > 0`
   * check waved through: `1e-10` is a positive number that scales to ZERO wei,
   * and the contract refuses a zero budget - so the caller paid for a
   * transaction to be told what the form already knew.
   */
  const budgetWei = useMemo(() => {
    const value = Number(budget);
    if (!Number.isFinite(value) || value <= 0) return null;
    const wei = BigInt(Math.round(value * 1e9)) * 10n ** 9n;
    return wei > 0n ? wei : null;
  }, [budget]);

  const maxBidsOk = Number.isInteger(Number(maxBids)) && Number(maxBids) >= 1 && Number(maxBids) <= LIMITS.bidsMax;
  const canCheck = Boolean(address && chainOk && texts.length === criteria.length && texts.length >= 1);
  const canPublish = Boolean(
    canCheck &&
      verdict?.scorable &&
      title.trim() &&
      budgetWei !== null &&
      maxBidsOk &&
      windowsOk &&
      !publishing,
  );

  const runCheck = useCallback(async () => {
    if (!address) return;
    setChecking(true);
    setMessage("");
    setFailed(false);
    setVerdict(null);
    try {
      const client = walletClient(address);
      const digest = await criteriaDigest(texts);

      // A verdict is final in either direction, so re-asking is refused by the
      // contract. Read first: if this exact wording has already been judged,
      // show that verdict instead of spending a transaction to be told so.
      const existingRaw = await client.readContract({
        address: CONTRACT,
        functionName: "check",
        args: [digest] as never[],
      });
      const existing = JSON.parse(String(existingRaw));
      if (existing?.found) {
        setVerdict({
          scorable: Boolean(existing.scorable),
          flagged: existing.flagged ?? [],
          reasons: existing.reasons ?? [],
          criteria: existing.criteria ?? [],
        });
        setAlreadyJudged(true);
        return;
      }
      setAlreadyJudged(false);

      const hash = (await client.writeContract({
        address: CONTRACT,
        functionName: "check_criteria",
        args: [texts] as never[],
        value: 0n,
      })) as string;

      const receipt = await waitAccepted(client, hash);

      const outcome = executionOf(receipt);
      if (outcome === "ERROR") {
        setFailed(true);
        setMessage(humanError(refusalOf(receipt)) || "The network could not judge these criteria.");
        return;
      }
      if (outcome === "UNKNOWN") {
        setFailed(true);
        setMessage(
          "The transaction settled but its outcome could not be read. The verdict may still have " +
            "been stored - check again in a moment before re-running it.",
        );
        return;
      }

      const raw = await client.readContract({
        address: CONTRACT,
        functionName: "check",
        args: [digest] as never[],
      });
      const parsed = JSON.parse(String(raw));
      if (!parsed.found) {
        setFailed(true);
        setMessage("The verdict was accepted but could not be read back. Try again in a moment.");
        return;
      }
      setVerdict({
        scorable: Boolean(parsed.scorable),
        flagged: parsed.flagged ?? [],
        reasons: parsed.reasons ?? [],
        criteria: parsed.criteria ?? [],
      });
    } catch (e) {
      setFailed(true);
      setMessage(readableError(e));
    } finally {
      setChecking(false);
    }
  }, [address, texts]);

  const publish = useCallback(async () => {
    if (!address) return;
    setPublishing(true);
    setMessage("");
    setFailed(false);
    try {
      const client = walletClient(address);
      if (budgetWei === null) {
        setFailed(true);
        setMessage("That budget does not convert to a non-zero amount.");
        return;
      }
      const wei = budgetWei;

      const hash = (await client.writeContract({
        address: CONTRACT,
        functionName: "open_round",
        args: [
          title.trim(),
          summary.trim(),
          texts,
          criteria.map((c) => c.weight),
          primary,
          `${commitAt}:00Z`,
          `${revealAt}:00Z`,
          `${decideAt}:00Z`,
          eligibility,
          Number(maxBids),
        ] as never[],
        value: wei,
      })) as string;

      const receipt = await waitAccepted(client, hash);

      const outcome = executionOf(receipt);
      if (outcome === "ERROR") {
        setFailed(true);
        setMessage(humanError(refusalOf(receipt)) || "The contract refused the call.");
        return;
      }
      if (outcome === "UNKNOWN") {
        // A budget is in flight. Reporting failure here would invite a second
        // publish and a SECOND escrow, which is the most expensive mistake this
        // form can make. Send them to the docket to look instead.
        setFailed(true);
        setMessage(
          "The transaction settled but its outcome could not be read from the receipt. " +
            "Do not publish again until you have checked the docket - the round may already " +
            "exist, and republishing would escrow a second budget.",
        );
        return;
      }

      // Past this point the publish has SUCCEEDED. Everything below is only
      // about naming the round it created, and none of it may turn the outcome
      // back into a failure.
      setPublished(true);
      setMessage(
        "Published, and the budget is escrowed. From this moment the criteria and weights cannot change - there is no method in the contract that edits them.",
      );

      try {
        // Find OUR round rather than assuming it is the last one: another buyer
        // publishing between the write and this read would otherwise send us to
        // their tender. `rounds_page` is newest first, so one page covers it.
        const digest = await criteriaDigest(texts);
        const page = JSON.parse(
          String(
            await client.readContract({
              address: CONTRACT,
              functionName: "rounds_page",
              args: [0, 12] as never[],
            }),
          ),
        );
        const mine = (page.rounds ?? []).find(
          (r: { buyer: string; criteria_hash: string; title: string; id: number }) =>
            r.buyer?.toLowerCase() === address.toLowerCase() &&
            r.criteria_hash === digest &&
            r.title === title.trim(),
        );
        // No guess. `total - 1` was the fallback here, and it is right only
        // while nobody else publishes and the read actually landed - the two
        // cases where the fallback is needed are exactly the two where it is
        // wrong. Sending a buyer to another buyer's tender, labelled as theirs,
        // is worse than sending them to the docket to find their own.
        if (typeof mine?.id === "number") setRoundId(mine.id);
      } catch {
        // Deliberately swallowed: the round exists either way.
      }
    } catch (e) {
      setFailed(true);
      setMessage(readableError(e));
    } finally {
      setPublishing(false);
    }
  }, [
    address,
    budget,
    commitAt,
    criteria,
    decideAt,
    eligibility,
    maxBids,
    primary,
    revealAt,
    summary,
    texts,
    title,
  ]);

  if (!CONTRACT_CONFIGURED) {
    return (
      <div className="note">
        <strong>No contract is configured for {network}.</strong> This form would run the
        scorability check against the network and then escrow a budget, but there is nothing to
        call. Deploy the contract and set <code className="mono">NEXT_PUBLIC_CACHET_ADDRESS</code>.
      </div>
    );
  }

  if (published) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span className="label">Published</span>
          <span className="label">{roundId !== null ? `round ${roundId}` : "on chain"}</span>
        </div>
        <div className="panel-body">
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--body)", marginBottom: 18 }}>
            {message}
          </p>
          {roundId !== null ? (
            <a className="btn btn-primary" href={`/r/${roundId}`}>
              Open round {roundId}
            </a>
          ) : (
            <>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)", marginBottom: 18 }}>
                Which round number it took could not be read back just now. The round is
                published either way - it is at the top of the docket, under your address.
                Do not publish again.
              </p>
              <a className="btn btn-primary" href="/rounds">
                Open the docket
              </a>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* connection */}
      <div className="panel">
        <div className="panel-head">
          <span className="label">Your account</span>
          <span className="label">{network}</span>
        </div>
        <div className="panel-body">
          {!address ? (
            <button className="btn btn-primary" onClick={connect} disabled={busy}>
              {busy ? "Connecting" : "Connect a wallet"}
            </button>
          ) : (
            <>
              <p className="hash" style={{ color: "var(--ink)" }}>
                {address}
              </p>
              {!chainOk ? (
                <div className="note note-warn" style={{ marginTop: 12 }}>
                  <strong>Wrong network.</strong> Switch to {network}.
                  <button className="btn btn-ghost btn-small" onClick={connect} style={{ marginTop: 10 }}>
                    Switch network
                  </button>
                </div>
              ) : null}
            </>
          )}
          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>

      {/* the tender */}
      <div className="panel">
        <div className="panel-head">
          <span className="label">The tender</span>
        </div>
        <div className="panel-body">
          <label className="field">
            <span className="label">Title</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Indexer replacement for the settlement archive"
              maxLength={120}
            />
          </label>
          <label className="field">
            <span className="label">What is being bought</span>
            <textarea
              className="textarea"
              style={{ minHeight: 90, fontFamily: "var(--sans)", fontSize: 15 }}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Two sentences on the scope. Bidders read this before the criteria."
              maxLength={600}
            />
          </label>
        </div>
      </div>

      {/* criteria */}
      <div className="panel">
        <div className="panel-head">
          <span className="label">Criteria and weights</span>
          <span className="label">
            {criteria.length} of {LIMITS.criteriaMax} max
          </span>
        </div>
        <div className="panel-body">
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)", marginBottom: 16 }}>
            Weights are yours and are published with the criteria. They never enter the prompt, so
            the network scores each criterion on its own and your priorities are applied in code
            afterwards. <strong>There is no method in this contract that edits either after
            publication.</strong>
          </p>

          {criteria.map((c, i) => (
            <div key={i} className="criterion-row">
              <input
                className="input"
                value={c.text}
                onChange={(e) => setCriterion(i, { text: e.target.value })}
                placeholder={
                  i === 0 ? "relevant delivered work with references" : "plan is specific and sequenced"
                }
                maxLength={160}
                aria-label={`Criterion ${i + 1}`}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="label" style={{ margin: 0 }}>
                  W
                </span>
                <input
                  className="input input-mono"
                  type="number"
                  min={1}
                  max={LIMITS.weightMax}
                  value={c.weight}
                  onChange={(e) =>
                    setCriterion(i, {
                      weight: Math.max(1, Math.min(LIMITS.weightMax, Number(e.target.value) || 1)),
                    })
                  }
                  aria-label={`Weight for criterion ${i + 1}`}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                <input
                  type="radio"
                  name="primary"
                  checked={primary === i}
                  onChange={() => setPrimary(i)}
                  aria-label={`Use criterion ${i + 1} as the tie break`}
                />
                <span className="label" style={{ margin: 0 }}>
                  Tie break
                </span>
              </label>
              <button
                className="btn btn-ghost btn-small"
                onClick={() => removeCriterion(i)}
                disabled={criteria.length <= 1}
                aria-label={`Remove criterion ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}

          <button
            className="btn btn-ghost btn-small"
            onClick={addCriterion}
            disabled={criteria.length >= LIMITS.criteriaMax}
            style={{ marginTop: 6 }}
          >
            Add a criterion
          </button>

          <p className="help">
            The tie break is part of the published standard, chosen now rather than after the
            scores arrive. Two bids on the same weighted total are separated by the criterion you
            mark here, and only then by the order the commitments arrived.
          </p>
        </div>
      </div>

      {/* the scorability check */}
      <div className="panel">
        <div className="panel-head">
          <span className="label">Scorability check</span>
          <span className="label">asks the network, costs no budget</span>
        </div>
        <div className="panel-body">
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)", marginBottom: 16 }}>
            Criteria that cannot be scored from proposal text produce scores nobody can defend.
            The network judges each one and the verdict is stored on chain - publishing refuses
            any criteria set that has not passed.
          </p>

          <button
            className="btn btn-primary"
            onClick={runCheck}
            disabled={!canCheck || checking}
          >
            {checking ? "The network is reading them" : "Check these criteria"}
          </button>

          {!canCheck && address ? (
            <p className="help">Fill in every criterion before checking.</p>
          ) : null}

          {/* The verdict arrives after a consensus round, long after the click.
              Announce it rather than leaving it to be discovered. */}
          <div aria-live="polite" aria-atomic="true">
          {verdict ? (
            <div className={verdict.scorable ? "note" : "note note-warn"} style={{ marginTop: 16 }}>
              <strong>
                {verdict.criteria.length - verdict.flagged.length} of {verdict.criteria.length}{" "}
                criteria can be scored from a proposal.
              </strong>
              {alreadyJudged ? (
                <>
                  {" "}
                  <span className="mono" style={{ fontSize: 11.5 }}>
                    (ALREADY ON CHAIN - NO TRANSACTION SENT)
                  </span>
                </>
              ) : null}
              {verdict.scorable ? (
                <>
                  <br />
                  This set is cleared to publish. The verdict is on chain, so bidders can see the
                  criteria were vetted before they wrote a word.
                </>
              ) : (
                <>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                    {verdict.flagged.map((idx, n) => (
                      <li key={idx} style={{ marginBottom: 6 }}>
                        <strong>{verdict.criteria[idx] ?? `criterion ${idx + 1}`}</strong> - {" "}
                        {verdict.reasons[n] ?? "cannot be scored from text"}
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: "10px 0 0" }}>
                    <strong>Reword the criterion to ask again.</strong> A verdict is final for the
                    exact wording it judged - asking the same question repeatedly until the answer
                    changes is not a check, so the contract refuses it. Editing the text asks a
                    genuinely new question.
                  </p>
                </>
              )}
            </div>
          ) : null}
          </div>
        </div>
      </div>

      {/* budget and windows */}
      <div className="panel">
        <div className="panel-head">
          <span className="label">Budget and windows</span>
          <span className="label">escrowed at publication</span>
        </div>
        <div className="panel-body">
          <div className="field-row">
            <label className="field">
              <span className="label">Budget in GEN</span>
              <input
                className="input input-mono"
                value={budget}
                onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="40000"
                inputMode="decimal"
              />
            </label>
            <label className="field">
              <span className="label">Maximum bids</span>
              <input
                className="input input-mono"
                type="number"
                min={1}
                max={LIMITS.bidsMax}
                value={maxBids}
                onChange={(e) => setMaxBids(e.target.value)}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="label">Commit closes (UTC)</span>
              <input
                className="input input-mono"
                type="datetime-local"
                value={commitAt}
                onChange={(e) => setCommitAt(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Reveal closes (UTC)</span>
              <input
                className="input input-mono"
                type="datetime-local"
                value={revealAt}
                onChange={(e) => setRevealAt(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Decision closes (UTC)</span>
              <input
                className="input input-mono"
                type="datetime-local"
                value={decideAt}
                onChange={(e) => setDecideAt(e.target.value)}
              />
            </label>
          </div>

          {budget.trim() && budgetWei === null ? (
            <p className="error">
              That is not a budget the contract can escrow. It must be a positive amount, and
              large enough not to round to zero.
            </p>
          ) : null}
          {!maxBidsOk ? (
            <p className="error">
              The maximum number of bids must be a whole number between 1 and {LIMITS.bidsMax}.
            </p>
          ) : null}
          {!windowsOk ? (
            <p className="error">
              The windows must run commit, then reveal, then decision, and all three must be in
              the future.
            </p>
          ) : null}

          <label className="field">
            <span className="label">Eligibility (optional)</span>
            <select
              className="select"
              value={eligibility}
              onChange={(e) => setEligibility(e.target.value)}
            >
              <option value="">Anyone may bid</option>
              <option value="no_prior_award">no_prior_award - nobody who has already won here</option>
            </select>
            <span className="help">
              Deterministic rules only, checked in code. Anything needing judgment belongs in the
              criteria above, where every bidder reads it in advance. Unknown rules are refused at
              publication rather than silently ignored.
            </span>
          </label>

          <p className="help">
            After the reveal window, the buyer has until the decision deadline to award or
            decline. After that it is permissionless - a buyer who dislikes the result cannot
            strand an escrowed budget by doing nothing.
          </p>
        </div>
      </div>

      {/* publish */}
      <div className="panel">
        <div className="panel-head">
          <span className="label">Publish and escrow</span>
          <span className="label">irreversible</span>
        </div>
        <div className="panel-body">
          {terms ? (
            <div className="note" style={{ marginBottom: 16 }}>
              <strong>The terms this round will carry.</strong>
              <br />
              Round fee {terms.fee_bps / 100}% of the awarded budget, charged at award and never
              on a declined round. Entry deposit {formatGen(terms.entry_deposit, 2)} GEN per
              bidder, refunded once their bid is scored. Appeal bond{" "}
              {formatGen(terms.appeal_bond, 2)} GEN.
              <br />
              <br />
              All three are copied onto the round at publication, so a later change by the
              contract owner cannot reach a tender whose bidders have already read the terms.
            </div>
          ) : (
            <div className="note note-warn" style={{ marginBottom: 16 }}>
              <strong>The current fee and deposits could not be read.</strong> They are not
              guessed here - publishing will still use whatever the contract holds, but you
              cannot see it from this screen until the read succeeds.
            </div>
          )}
          <div className="note note-warn" style={{ marginBottom: 16 }}>
            <strong>Once published, the criteria and weights cannot be changed.</strong> There is
            no method in the contract that edits them, and no owner override. Check before you
            publish.
          </div>
          <button className="btn btn-primary" onClick={publish} disabled={!canPublish}>
            {publishing ? "Waiting on the network" : "Publish and escrow"}
          </button>
          {!verdict?.scorable && address ? (
            <p className="help">The criteria have to pass the scorability check first.</p>
          ) : null}
          <div aria-live="polite" aria-atomic="true">
            {message ? (
              <div className={failed ? "note note-warn" : "note"} style={{ marginTop: 14 }}>
                <strong>{failed ? "Refused." : "Done."}</strong> {message}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
