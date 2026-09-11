"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  executionOf,
  readableError,
  refusalOf,
  useWallet,
  waitAccepted,
  walletClient,
} from "@/components/wallet";
import { CACHET as CONTRACT, IS_LIVE as CONTRACT_CONFIGURED } from "@/lib/chain";
import { formatDate, humanError } from "@/lib/format";
import type { Bid, Round } from "@/lib/types";

/**
 * Everything that moves a round from revealed to settled.
 *
 * Score, resolve an appeal, award, decline, sweep, expire. Every one of these
 * existed in the contract, was described on /docs and listed on /contract,
 * and none of them had a button. A round published and bid on through the
 * site stopped dead at the first score: the only way on was
 * scripts/settle.mjs with a private key in the environment, which is not a
 * path a buyer or a reviewer walks.
 *
 * Each control is gated by the contract's own rule, in the contract's own
 * order, so the reason a button is unavailable is the reason the contract
 * would give - before a transaction is spent finding out. The permissionless
 * ones (score, resolve, sweep, expire, and award once the decision window has
 * passed) are offered to any connected wallet; decline, and award inside the
 * decision window, only to the buyer.
 */

const DONE: Record<string, string> = {
  score: "Scored. The card is on this page, and the appeal window on it has started.",
  resolve_appeal: "Appeal resolved. The re-scored card replaces the old one.",
  award:
    "Awarded. Every bidder who turned up can now claim what they are owed from their bid page.",
  decline:
    "Declined. The budget is released to the buyer, and every bidder who turned up can claim their deposit.",
  sweep: "Unopened bids are now marked expired.",
  expire: "Abandoned. The budget is released to the buyer.",
};

export default function RoundActions({ round, bids }: { round: Round; bids: Bid[] }) {
  const wallet = useWallet();
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "done" | "failed" | "unknown">("idle");
  const [why, setWhy] = useState("");

  // The clock is read in the browser, after mount. Rendering it on the server
  // would hand the client a different "now" to hydrate against, and every gate
  // below depends on it. Ticking keeps a button from staying shut after the
  // window it was waiting on has already passed.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);

  const send = useCallback(
    async (key: string, fn: string, args: unknown[]) => {
      if (!wallet.address) return;
      setBusy(key);
      setMessage("");
      setState("idle");
      // Whether the write left. A throw after that is the receipt going
      // unread, not a refusal, and reporting it as one would invite the same
      // settlement to be sent twice.
      let sent = false;
      try {
        const client = await walletClient(wallet.address);
        const hash = (await client.writeContract({
          address: CONTRACT,
          functionName: fn,
          args: args as never[],
          value: 0n,
        })) as string;
        sent = true;
        const receipt = await waitAccepted(client, hash);
        const outcome = executionOf(receipt);
        if (outcome === "SUCCESS") {
          setState("done");
          setMessage(DONE[fn] ?? "Done.");
          if (fn === "decline") setWhy("");
          router.refresh();
        } else if (outcome === "ERROR") {
          setState("failed");
          setMessage(humanError(refusalOf(receipt)) || "The contract refused the call.");
        } else {
          setState("unknown");
          setMessage(
            "The transaction settled but its outcome could not be read. Reload this page before " +
              "sending it again - it may already have landed.",
          );
        }
      } catch (e) {
        setState(sent ? "unknown" : "failed");
        setMessage(
          sent
            ? "The transaction was sent but its outcome could not be read. Reload before sending " +
                "it again. " +
                readableError(e)
            : readableError(e),
        );
      } finally {
        setBusy(null);
      }
    },
    [wallet.address, router],
  );

  if (!CONTRACT_CONFIGURED || round.status !== "open" || now === null) return null;

  const at = (iso: string) => Date.parse(iso);
  const pastReveal = now > at(round.reveal_closes);
  const pastDecide = now > at(round.decide_closes);
  const windowCloses = round.appeal_window_closes ? at(round.appeal_window_closes) : 0;
  const inWindow = now < windowCloses;

  const revealed = bids.filter((b) => b.status === "revealed");
  const appeals = bids.filter((b) => b.appeal_status === "open");
  const scored = bids.filter((b) => b.status === "scored");
  const sealed = bids.filter((b) => b.status === "sealed");

  const connected = Boolean(wallet.address);
  const isBuyer = Boolean(
    wallet.address && round.buyer.toLowerCase() === wallet.address.toLowerCase(),
  );
  const locked = busy !== null || !connected;

  // Award, gated in the order the contract checks.
  const awardBlock = !pastReveal
    ? `Opens once reveals close, at ${formatDate(round.reveal_closes)}.`
    : revealed.length > 0
      ? `Every revealed bid has to be scored first - ${revealed.length} still waiting.`
      : appeals.length > 0
        ? "An appeal is open. It has to be resolved first, and anyone can resolve it."
        : scored.length === 0
          ? "No bid was scored, so there is nothing to award."
          : inWindow
            ? `Held for the appeal window on the last score, until ${formatDate(round.appeal_window_closes)}.`
            : !isBuyer && !pastDecide
              ? `Only the buyer can award before ${formatDate(round.decide_closes)}. After that, anyone can.`
              : null;

  // Decline, the buyer's alone, gated the same way.
  const declineBlock = !pastReveal
    ? "Opens once reveals close."
    : pastDecide
      ? "The decision window has closed. Expire returns the budget instead."
      : revealed.length > 0
        ? "Every revealed bid has to be scored first, so a result cannot be walked away from before it is known."
        : appeals.length > 0
          ? "An appeal is open. It has to be resolved first."
          : inWindow
            ? `Held for the appeal window on the last score, until ${formatDate(round.appeal_window_closes)}.`
            : null;

  // Expire refuses while an appeal is open, and on any round that could be
  // awarded instead - it is the escape hatch, not a way around a result.
  const awardable = revealed.length === 0 && appeals.length === 0 && scored.length > 0;
  const expireBlock =
    appeals.length > 0
      ? "An appeal is open. Resolve it first."
      : awardable
        ? "This round can be awarded, so it cannot be abandoned. Award it instead."
        : null;

  const showAward = pastReveal;
  const showDecline = isBuyer && pastReveal && !pastDecide;
  const showSweep = pastReveal && sealed.length > 0;
  const showExpire = pastDecide;
  const anything =
    revealed.length > 0 || appeals.length > 0 || showAward || showDecline || showSweep || showExpire;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="label">Settle this round</span>
        <span className="label">{isBuyer ? "YOU ARE THE BUYER" : "SCORING IS OPEN TO ANYONE"}</span>
      </div>
      <div className="panel-body">
        {!connected ? (
          <p className="panel-note">
            Connect a wallet to score bids or settle this round. Scoring and resolving appeals are
            open to anyone.
          </p>
        ) : null}

        {!anything ? (
          <p className="panel-note">
            Nothing to settle yet. A bid has to be revealed before it can be scored.
          </p>
        ) : null}

        {revealed.map((b) => (
          <div className="bidder-row settle-group" key={`s${b.i}`}>
            <div>
              <div className="label">Bid {b.i + 1} is waiting for a score</div>
              <p className="panel-note">
                Validators grade it against the frozen criteria and have to agree. Open to anyone,
                and it takes a minute or two.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={locked}
              onClick={() => send(`s${b.i}`, "score", [round.id, b.i])}
            >
              {busy === `s${b.i}` ? "Scoring" : "Score"}
            </button>
          </div>
        ))}

        {appeals.map((b) => (
          <div className="bidder-row settle-group" key={`a${b.i}`}>
            <div>
              <div className="label">Bid {b.i + 1} has an open appeal</div>
              <p className="panel-note">
                A fresh set of validators re-scores the whole card with the bidder&apos;s argument in
                front of them. Open to anyone, and the award waits on it.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={locked}
              onClick={() => send(`a${b.i}`, "resolve_appeal", [round.id, b.i])}
            >
              {busy === `a${b.i}` ? "Resolving" : "Resolve"}
            </button>
          </div>
        ))}

        {showAward ? (
          <div className="bidder-row settle-group">
            <div>
              <div className="label">Award</div>
              <p className="panel-note">
                {awardBlock ??
                  "The highest weighted total takes it. Every bidder who turned up can then claim their deposit."}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={locked || awardBlock !== null}
              onClick={() => send("award", "award", [round.id])}
            >
              {busy === "award" ? "Awarding" : "Award"}
            </button>
          </div>
        ) : null}

        {showDecline ? (
          <div className="settle-group">
            <div className="label">Decline</div>
            <p className="panel-note">
              {declineBlock ??
                "Releases the budget and every deposit a bidder who turned up paid. The reason is published on the round."}
            </p>
            {declineBlock === null ? (
              <>
                <label className="field">
                  <span className="label">Why</span>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={300}
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    placeholder="No bid was revealed before the reveal window closed."
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={locked || !why.trim()}
                  onClick={() => send("decline", "decline", [round.id, why.trim()])}
                >
                  {busy === "decline" ? "Declining" : "Decline"}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {showSweep ? (
          <div className="bidder-row settle-group">
            <div>
              <div className="label">
                {sealed.length} bid{sealed.length === 1 ? " was" : "s were"} never opened
              </div>
              <p className="panel-note">
                Marks them expired and forfeits their deposits. Award, decline and expire do this
                themselves; this only brings the page up to date.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={locked}
              onClick={() => send("sweep", "sweep", [round.id])}
            >
              {busy === "sweep" ? "Sweeping" : "Sweep"}
            </button>
          </div>
        ) : null}

        {showExpire ? (
          <div className="bidder-row settle-group">
            <div>
              <div className="label">Abandon the round</div>
              <p className="panel-note">
                {expireBlock ??
                  "The decision window has passed and this round cannot be awarded. Nobody wins; the budget is released to the buyer and every bidder who turned up can claim."}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={locked || expireBlock !== null}
              onClick={() => send("expire", "expire", [round.id])}
            >
              {busy === "expire" ? "Expiring" : "Expire"}
            </button>
          </div>
        ) : null}

        {message ? (
          <p className={`note ${state === "failed" ? "note-bad" : ""}`} style={{ marginTop: 14 }}>
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
