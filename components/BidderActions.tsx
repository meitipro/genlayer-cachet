"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  readableError,
  useWallet,
  waitAccepted,
  walletClient,
  executionOf,
  refusalOf,
} from "@/components/wallet";
import { CACHET as CONTRACT, IS_LIVE as CONTRACT_CONFIGURED } from "@/lib/chain";
import { LIMITS } from "@/lib/limits";
import { formatGen, humanError } from "@/lib/format";
import type { Bid, Round } from "@/lib/types";

/**
 * The two things a bidder does after their card exists: contest it, and take
 * what they are owed.
 *
 * Both were reachable only by calling the contract directly. `appeal_score`
 * and `claim` were named on `/contract` and described on `/docs`, and there
 * was no screen anywhere that sent either one - so a bidder who disagreed with
 * a mark had a documented remedy and no way to use it, and a deposit came back
 * only to whoever knew how to write a transaction by hand.
 *
 * Deliberately one component. They are the same person at the same moment
 * looking at the same card, and splitting them put the deposit on a different
 * screen from the reason they might want to argue about it.
 */

type Action = "appeal" | "claim";

export default function BidderActions({
  round,
  bid,
  /** The instant an award becomes possible, from the contract. */
  appealWindowCloses,
}: {
  round: Round;
  bid: Bid;
  appealWindowCloses: string;
}) {
  const wallet = useWallet();
  const router = useRouter();
  const [argument, setArgument] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "done" | "failed" | "unknown">("idle");

  const mine = Boolean(
    wallet.address && bid.bidder.toLowerCase() === wallet.address.toLowerCase(),
  );
  const owed = BigInt(bid.owed || "0");

  /**
   * Whether an appeal is still possible, decided the way the contract decides
   * it rather than by a rule restated here.
   *
   * `appeal_score` refuses on a settled round, on a bid that is not scored,
   * and on a bid already appealed. Those are the three, and each maps to a
   * sentence below rather than to a disabled button with no explanation.
   */
  const appealable = useMemo(() => {
    if (round.status !== "open") return "This round has settled, so nothing can be contested now.";
    if (bid.status !== "scored") return "A bid can be contested once it has been scored.";
    if (bid.appeal_status === "open") return "This bid already has an appeal open.";
    // The contract spells "never appealed" as the empty string, not as a word.
    // Anything else here is a closed appeal, and each bid gets exactly one.
    if (bid.appeal_status !== "") return "This bid has already been appealed once.";
    return null;
  }, [round.status, bid.status, bid.appeal_status]);

  const send = useCallback(
    async (action: Action) => {
      if (!wallet.address) return;
      setBusy(action);
      setMessage("");
      setState("idle");
      // Whether the write left. A throw after that point is the receipt going
      // unread, not a refusal, and reporting it as one would invite a second
      // bond or a second claim on money already moving.
      let sent = false;
      try {
        const client = await walletClient(wallet.address);
        const hash = (await client.writeContract({
          address: CONTRACT,
          functionName: action === "appeal" ? "appeal_score" : "claim",
          args:
            action === "appeal"
              ? ([round.id, bid.i, argument.trim()] as never[])
              : ([round.id, bid.i] as never[]),
          value: action === "appeal" ? BigInt(round.appeal_bond) : 0n,
        })) as string;
        sent = true;

        const receipt = await waitAccepted(client, hash);
        const outcome = executionOf(receipt);
        if (outcome === "SUCCESS") {
          setState("done");
          setMessage(
            action === "appeal"
              ? "Appeal opened. Anyone can resolve it now, and the award is held until somebody does."
              : "Claimed. The transfer settles on finality.",
          );
          setArgument("");
          router.refresh();
        } else if (outcome === "ERROR") {
          setState("failed");
          setMessage(humanError(refusalOf(receipt)) || "The contract refused the call.");
        } else {
          setState("unknown");
          setMessage(
            "The transaction settled but its outcome could not be read. Reload this page " +
              "before sending it again - it may already have landed.",
          );
        }
      } catch (e) {
        setState(sent ? "unknown" : "failed");
        setMessage(
          sent
            ? "The transaction was sent but its outcome could not be read. Reload before " +
              "sending it again. " +
              readableError(e)
            : readableError(e),
        );
      } finally {
        setBusy(null);
      }
    },
    [wallet.address, round.id, round.appeal_bond, bid.i, argument, router],
  );

  if (!CONTRACT_CONFIGURED || !mine) return null;

  const tooShort = argument.trim().length < LIMITS.argumentMin;
  const tooLong = argument.trim().length > LIMITS.argumentMax;

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-head">
        <span className="label">Your bid</span>
        <span className="label">BID {bid.i + 1}</span>
      </div>
      <div className="panel-body">
        {/* ---- claim ------------------------------------------------- */}
        <div className="bidder-row">
          <div>
            <div className="label">Owed to you</div>
            <div className="stat-value mono">
              {formatGen(bid.owed)} <span className="stat-unit">GEN</span>
            </div>
            <p className="panel-note">
              {owed > 0n
                ? "Your deposit, and an appeal bond if one was upheld. Pull rather than push, so one failing transfer cannot hold up the settlement."
                : round.status === "open" && bid.status !== "withdrawn"
                  ? "Nothing to pull yet. A deposit is returned when the round settles, and immediately if you withdraw before the window shuts."
                  : "Nothing outstanding on this bid."}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={owed <= 0n || busy !== null}
            onClick={() => send("claim")}
          >
            {busy === "claim" ? "Claiming" : "Claim"}
          </button>
        </div>

        {/* ---- appeal ------------------------------------------------ */}
        <div className="bidder-appeal">
          <div className="label" style={{ marginBottom: 10 }}>
            Contest this scorecard
          </div>
          {appealable ? (
            <p className="panel-note">{appealable}</p>
          ) : (
            <>
              <p className="panel-note">
                Bonding {formatGen(round.appeal_bond)} GEN has your whole card re-scored by a fresh
                set of validators, with your argument in front of them. The bond comes back only if
                the total goes up; if it holds or falls it pays for the re-scoring. Once per bid.
                {appealWindowCloses ? (
                  <> The award is held until {appealWindowCloses} at the earliest.</>
                ) : null}
              </p>
              <label className="field">
                <span className="label">
                  Your argument{" "}
                  <span className="mono" style={{ opacity: 0.7 }}>
                    {argument.trim().length} / {LIMITS.argumentMax}
                  </span>
                </span>
                <textarea
                  className="input"
                  rows={4}
                  value={argument}
                  onChange={(e) => setArgument(e.target.value)}
                  maxLength={LIMITS.argumentMax}
                  placeholder="Point at what the scorer missed, and where in your proposal it is. An argument that asserts something the proposal does not say is ignored."
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={tooShort || tooLong || busy !== null}
                onClick={() => send("appeal")}
              >
                {busy === "appeal"
                  ? "Sending"
                  : `Appeal, bonding ${formatGen(round.appeal_bond)} GEN`}
              </button>
              {tooShort && argument.length > 0 ? (
                <p className="panel-note">
                  An argument needs at least {LIMITS.argumentMin} characters. The contract refuses
                  a shorter one.
                </p>
              ) : null}
            </>
          )}
        </div>

        {message ? (
          <p className={`note ${state === "failed" ? "note-bad" : ""}`} style={{ marginTop: 14 }}>
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
