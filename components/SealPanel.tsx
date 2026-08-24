"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { formatDate, formatGen, humanError } from "@/lib/format";
import { commitmentFor, newSalt } from "@/lib/seal";
import type { Bid, Round } from "@/lib/types";

/**
 * Seal a proposal, and later open it.
 *
 * The proposal never leaves this tab before the reveal. Hashing happens in the
 * browser with Web Crypto, and the only thing that reaches the network during
 * the commit window is 64 hex characters. That is the whole point of a sealed
 * tender: there is no server here that could leak a price even if it wanted
 * to, and there is deliberately no contract view that would hash a proposal
 * for you - calling one would put the text on the wire.
 */

const SALT_KEY = (round: number, who: string) => `cachet:salt:${round}:${who.toLowerCase()}`;
const TEXT_KEY = (round: number, who: string) => `cachet:draft:${round}:${who.toLowerCase()}`;

/**
 * localStorage, for browsers that refuse to have one.
 *
 * With site data blocked, or in some private-browsing modes, merely touching
 * `window.localStorage` throws a SecurityError. Unguarded, that exception
 * escapes a render effect and takes the whole page to the error boundary - so
 * the panel that hashes proposals locally would be broken for exactly the
 * privacy-minded reader most likely to have turned storage off.
 *
 * Losing the store is survivable: the salt is on screen to be copied, and the
 * reveal field below accepts it back. Losing the page is not.
 */
const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* nothing to do: the salt is displayed, and the reveal accepts a paste */
    }
  },
};

type Phase = "idle" | "signing" | "sent" | "done" | "failed" | "unknown";

/** Everything this panel can send. All four are the bidder acting on their own bid. */
type Action = "commit" | "amend" | "reveal" | "withdraw";

const DONE: Record<Action, string> = {
  commit: "Bid sealed. Keep the salt below - you cannot open this commitment without it.",
  amend:
    "Commitment replaced. The reveal must now match THIS text, so keep the version above and the same salt.",
  reveal: "Revealed, and the text matched the seal. Scoring is permissionless from here.",
  withdraw:
    "Withdrawn, and the deposit is yours to claim. The slot is free for someone else, and you may seal a new bid while the window is open.",
};

export default function SealPanel({
  round,
  bids,
  phase,
  minLength,
  maxLength,
}: {
  round: Round;
  bids: Bid[];
  phase: "commit" | "reveal" | "decide" | "settled";
  minLength: number;
  maxLength: number;
}) {
  const router = useRouter();
  const { address, chainOk, busy, error, connect, network } = useWallet();
  const [proposal, setProposal] = useState("");
  const [salt, setSalt] = useState("");
  const [digest, setDigest] = useState("");
  const [state, setState] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState("");

  /**
   * Which bid on this round is yours.
   *
   * Read from the chain rather than typed in. Asking a bidder to count rows and
   * subtract one, on the screen whose entire job is getting a seal right, is a
   * way to have somebody reveal against a stranger's commitment and be told
   * their own proposal does not match.
   */
  const mine = useMemo(() => {
    if (!address) return undefined;
    const ours = bids.filter((b) => b.bidder.toLowerCase() === address.toLowerCase());
    // A bidder who withdrew and came back has two rows here. The live one is
    // the one every button on this panel is about; matching the withdrawn row
    // instead would tell them they had already bid when they had not.
    return ours.find((b) => b.status !== "withdrawn") ?? ours[0];
  }, [address, bids]);

  /** Their bid, only while it is still sealed - what `amend` and `withdraw` act on. */
  const sealedMine = mine && mine.status === "sealed" ? mine : undefined;

  /**
   * The salt: made here during a commit, recovered during a reveal.
   *
   * Generating one is only ever correct while the commit window is open. In
   * the reveal window a missing salt means this browser is not the one that
   * sealed the bid - a different machine, or storage since cleared - and
   * minting a fresh random value there would put a number under the word
   * "Salt" that can never open the commitment it sits beside. The bidder is
   * then told to check a salt that the page itself invented.
   *
   * So during a reveal it stays empty and the field below asks for it.
   */
  useEffect(() => {
    if (!address) return;
    const stored = store.get(SALT_KEY(round.id, address));
    if (stored) {
      setSalt(stored);
    } else if (phase === "commit") {
      const made = newSalt();
      store.set(SALT_KEY(round.id, address), made);
      setSalt(made);
    } else {
      setSalt("");
    }
    const draft = store.get(TEXT_KEY(round.id, address));
    if (draft) setProposal(draft);
  }, [address, round.id, phase]);

  /** A salt typed or pasted back in, on a browser that never held it. */
  const onSalt = useCallback(
    (value: string) => {
      const clean = value.trim().toLowerCase().replace(/^0x/, "");
      setSalt(clean);
      if (address && clean) store.set(SALT_KEY(round.id, address), clean);
    },
    [address, round.id],
  );

  useEffect(() => {
    if (!address || !salt || !proposal) {
      setDigest("");
      return;
    }
    let alive = true;
    commitmentFor(salt, address, proposal).then((d) => {
      if (alive) setDigest(d);
    });
    return () => {
      alive = false;
    };
  }, [address, salt, proposal]);

  const onProposal = useCallback(
    (value: string) => {
      setProposal(value);
      if (address) store.set(TEXT_KEY(round.id, address), value);
    },
    [address, round.id],
  );

  const tooShort = proposal.length > 0 && proposal.length < minLength;
  const tooLong = proposal.length > maxLength;
  const ready = Boolean(address && chainOk && digest && !tooShort && !tooLong);
  /** Reveal window, wallet connected, and this browser never held the salt. */
  const saltMissing = phase === "reveal" && Boolean(address) && !salt;

  const send = useCallback(
    async (kind: Action) => {
      if (!address) return;
      setState("signing");
      setMessage("");
      setHash("");
      try {
        const client = walletClient(address);
        if (kind !== "commit" && !mine) {
          setState("failed");
          setMessage("This address has no sealed bid on this round.");
          return;
        }
        const args =
          kind === "commit"
            ? [round.id, digest]
            : kind === "reveal"
              ? [round.id, mine!.i, salt, proposal]
              : kind === "amend"
                ? [round.id, mine!.i, digest]
                : [round.id, mine!.i];
        const value = kind === "commit" ? BigInt(round.entry_deposit) : 0n;

        const txHash = (await client.writeContract({
          address: CONTRACT,
          functionName: kind,
          args: args as never[],
          value,
        })) as string;

        setHash(txHash);
        setState("sent");

        const receipt = await waitAccepted(client, txHash);

        const outcome = executionOf(receipt);
        if (outcome === "SUCCESS") {
          setState("done");
          setMessage(DONE[kind]);
          // `bids` is a server-rendered prop, and every button on this panel is
          // decided from it. Without this the panel keeps describing the state
          // before the transaction: still offering to seal after a commit, or
          // still offering to withdraw a bid that is already withdrawn.
          router.refresh();
        } else if (outcome === "ERROR") {
          setState("failed");
          setMessage(humanError(refusalOf(receipt)) || "The contract refused the call.");
        } else {
          // The transaction landed but the receipt carried no leader round, so
          // neither answer is available. Saying "refused" here would invite a
          // second commit and a second entry deposit; saying "sealed" would
          // hand out a confirmation that might be false. Say neither.
          setState("unknown");
          setMessage(
            "The transaction settled but its outcome could not be read from the receipt. " +
              "Check the round page before sending this again - it may already have landed.",
          );
        }
      } catch (e) {
        setState("failed");
        setMessage(readableError(e));
      }
    },
    [address, digest, mine, proposal, round.entry_deposit, round.id, router, salt],
  );

  if (!CONTRACT_CONFIGURED) {
    return (
      <div className="note">
        <strong>No contract is configured for {network}.</strong> This panel would hash your
        proposal locally and submit only the digest, but there is nothing to submit it to. Deploy
        the contract and set <code className="mono">NEXT_PUBLIC_CACHET_ADDRESS</code>.
      </div>
    );
  }

  if (phase === "settled") {
    return (
      <div className="note">
        <strong>This round is settled.</strong> Nothing can be committed or revealed against it.
        The scorecards are on the round page and stay there.
      </div>
    );
  }

  // `decide` means BOTH windows have closed. Offering a reveal button here
  // would hand a bidder a button whose only possible outcome is a refusal, on
  // the screen where they are most likely to believe they still have time.
  if (phase === "decide") {
    return (
      <div className="note note-warn">
        <strong>The reveal window has closed.</strong> Nothing further can be committed or
        revealed against this round - it is now waiting on the buyer to award or decline.
        <br />
        <br />
        If you committed and never opened your seal, that commitment expires unscored and its
        deposit is forfeited. Any bid that was revealed in time is still scored and still ranked.
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
            <>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", marginBottom: 14 }}>
                Your address goes inside the commitment hash, so a commitment copied out of public
                state cannot be opened by whoever copied it. That means the seal cannot be
                computed until a wallet is connected.
              </p>
              <button className="btn btn-primary" onClick={connect} disabled={busy}>
                {busy ? "Connecting" : "Connect a wallet"}
              </button>
            </>
          ) : (
            <>
              <p className="hash" style={{ color: "var(--ink)" }}>
                {address}
              </p>
              {!chainOk ? (
                <div className="note note-warn" style={{ marginTop: 12 }}>
                  <strong>Wrong network.</strong> Switch to {network} - this contract does not
                  exist anywhere else.
                  <br />
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={connect}
                    style={{ marginTop: 10 }}
                  >
                    Switch network
                  </button>
                </div>
              ) : null}
            </>
          )}
          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>

      {/* the editor */}
      <div className="panel">
        <div className="panel-head">
          <span className="label">Your proposal</span>
          <span className="label">
            {proposal.length.toLocaleString("en-US")} / {maxLength.toLocaleString("en-US")}
          </span>
        </div>
        <div className="panel-body">
          <label className="field">
            <span className="label">
              Write it here. It stays in this browser until you reveal.
            </span>
            <textarea
              className="textarea"
              value={proposal}
              onChange={(e) => onProposal(e.target.value)}
              placeholder={round.criteria
                .map((c, i) => `${i + 1}. ${c.text}\n\n`)
                .join("")}
              spellCheck
            />
          </label>
          {tooShort ? (
            <p className="error">
              Too short. The contract refuses anything under {minLength} characters, because a
              proposal that short cannot be scored against {round.criteria.length} criteria.
            </p>
          ) : null}
          {tooLong ? (
            <p className="error">
              Too long by {(proposal.length - maxLength).toLocaleString("en-US")} characters. The
              contract stores at most {maxLength.toLocaleString("en-US")}.
            </p>
          ) : null}
          <p className="help">
            Write to the criteria in order and name things a reader can check - dates, prices,
            references. The criteria state that an unevidenced claim scores lower than an
            evidenced one, and that a proposal which asks for a particular score or addresses the
            scorer directly is scored zero on every criterion.
          </p>
        </div>
      </div>

      {/* the seal */}
      <div className="panel">
        <div className="panel-head">
          <span className="label">Your commitment</span>
          <span className="label">computed in this browser</span>
        </div>
        <div className="panel-body">
          {digest ? (
            <>
              <p className="hash" style={{ fontSize: 13.5, color: "var(--ink)" }}>
                {digest}
              </p>
              {/* Only while sealing. In the reveal window the salt has its own
                  editable field above, and repeating it here as static text
                  would leave two salts on one screen with no way to tell which
                  one the button is about to use. */}
              {phase === "commit" ? (
                <div className="note" style={{ marginTop: 14 }}>
                  <strong>Salt: </strong>
                  <code className="mono" style={{ fontSize: 12.5 }}>
                    {salt}
                  </code>
                  <br />
                  Copy this somewhere safe. The reveal needs the salt, your address and the exact
                  proposal text - byte for byte. Clearing this browser&rsquo;s storage without the
                  salt written down means the bid expires unscored and the deposit is forfeited.
                </div>
              ) : null}
            </>
          ) : (
            <p style={{ fontSize: 14, color: "var(--faint)", margin: 0 }}>
              {address
                ? "Write a proposal above and the seal appears here. Nothing is sent while you type."
                : "Connect a wallet and write a proposal to compute the seal."}
            </p>
          )}
        </div>
      </div>

      {/* the action */}
      {phase === "commit" ? (
        <div className="panel">
          <div className="panel-head">
            <span className="label">Seal and submit</span>
            <span className="label">
              deposit {formatGen(round.entry_deposit, 2)} GEN
            </span>
          </div>
          <div className="panel-body">
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", marginBottom: 16 }}>
              This sends the 64 hex characters above and the entry deposit. It does not send your
              proposal. Commits close {formatDate(round.commit_closes, true)}; the deposit comes
              back once your bid is scored, and is forfeited only if you never open the seal.
            </p>
            {/* An address with a live bid is not stuck with it. While the
                window is open the contract lets them replace the digest or
                pull out entirely, so this panel offers both rather than a
                disabled button and an apology. */}
            {sealedMine ? (
              <div className="note" style={{ marginBottom: 16 }}>
                <strong>
                  This address has already sealed bid {sealedMine.i + 1} on this round.
                </strong>{" "}
                One live bid per address, but nothing is fixed until the window closes
                {sealedMine.amendments > 0 ? (
                  <>
                    {" "}
                    - you have already revised it {sealedMine.amendments} time
                    {sealedMine.amendments === 1 ? "" : "s"}
                  </>
                ) : null}
                . Edit the proposal above and replace the seal, or withdraw and take the deposit
                back.
                <div className="btn-row" style={{ marginTop: 14 }}>
                  <button
                    className="btn btn-ghost btn-small"
                    disabled={
                      !ready ||
                      digest === sealedMine.commitment ||
                      state === "signing" ||
                      state === "sent"
                    }
                    onClick={() => send("amend")}
                  >
                    {digest && digest === sealedMine.commitment
                      ? "Seal is unchanged"
                      : "Replace my seal"}
                  </button>
                  <button
                    className="btn btn-ghost btn-small"
                    disabled={state === "signing" || state === "sent"}
                    onClick={() => send("withdraw")}
                  >
                    Withdraw this bid
                  </button>
                </div>
              </div>
            ) : null}
            <button
              className="btn btn-primary"
              disabled={!ready || Boolean(sealedMine) || state === "signing" || state === "sent"}
              onClick={() => send("commit")}
            >
              {state === "signing"
                ? "Waiting on your wallet"
                : state === "sent"
                  ? "Validators are working"
                  : "Seal and submit"}
            </button>
            <TxNote state={state} message={message} hash={hash} />
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <span className="label">Open your seal</span>
            <span className="label">
              reveal closes {formatDate(round.reveal_closes)}
            </span>
          </div>
          <div className="panel-body">
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", marginBottom: 16 }}>
              The text must hash to the digest you committed. If it does not, the call is refused
              and <strong>nothing is stored</strong> - you can correct it and try again while the
              window is open. Reveals are only possible after the commit window closes, so no
              later bidder can price against an opened proposal.
            </p>
            {address && !mine ? (
              <div className="note note-warn" style={{ marginBottom: 16 }}>
                <strong>This address has no sealed bid on this round.</strong> Reveals can only be
                made by the address that committed - the address is inside the commitment hash.
              </div>
            ) : null}
            {mine && mine.status !== "sealed" ? (
              <div className="note" style={{ marginBottom: 16 }}>
                <strong>Bid {mine.i + 1} is already {mine.status}.</strong>{" "}
                {mine.status === "scored"
                  ? "Its scorecard is on the round page."
                  : "There is nothing left to open."}
              </div>
            ) : null}
            {/* The salt is half of what opens a commitment, and it lives in one
                browser. A bidder who sealed on a laptop and came back on a
                desktop did nothing wrong and has it written down, exactly as
                this panel told them to - so there has to be somewhere to put
                it back. Editing it re-hashes as you type, which turns the
                "matches the seal" line below into live confirmation. */}
            {mine && mine.status === "sealed" ? (
              <label className="field" style={{ marginBottom: 16 }}>
                <span className="label">
                  Your salt {saltMissing ? "- not in this browser, paste it here" : ""}
                </span>
                <input
                  className="input input-mono"
                  value={salt}
                  onChange={(e) => onSalt(e.target.value)}
                  placeholder="the 32-character salt shown when you sealed this bid"
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby="salt-help"
                />
                <p className="help" id="salt-help">
                  {saltMissing
                    ? "This browser has no salt stored for this round, so it has not guessed one. Paste the salt you copied when you sealed the bid."
                    : "Recovered from this browser. Replace it if you sealed this bid somewhere else."}
                </p>
              </label>
            ) : null}
            {mine && mine.status === "sealed" ? (
              <div className="note" style={{ marginBottom: 16 }}>
                <strong>Bid {mine.i + 1} is yours.</strong>
                <br />
                Committed {formatDate(mine.committed_at, true)}, sealed as{" "}
                <code className="mono" style={{ fontSize: 11.5, wordBreak: "break-all" }}>
                  {mine.commitment}
                </code>
                {/* Three states, not two. "Does not match" is a claim about
                    the text, and making it while a required input is simply
                    absent would send a bidder off to hunt for a discrepancy in
                    a proposal that may be perfectly correct. */}
                {!salt || !proposal ? (
                  <>
                    <br />
                    <br />
                    The seal cannot be checked yet - {!salt && !proposal
                      ? "the salt and the proposal text are both still empty"
                      : !salt
                        ? "the salt is still empty"
                        : "the proposal text is still empty"}
                    .
                  </>
                ) : digest && digest !== mine.commitment ? (
                  <>
                    <br />
                    <br />
                    The text above does <strong>not</strong> hash to that seal yet. Revealing now
                    would be refused - check the salt and that the proposal is byte-identical.
                  </>
                ) : digest ? (
                  <>
                    <br />
                    <br />
                    The text above matches the seal. This reveal will be accepted.
                  </>
                ) : null}
              </div>
            ) : null}
            <button
              className="btn btn-primary"
              disabled={
                !ready ||
                !mine ||
                mine.status !== "sealed" ||
                state === "signing" ||
                state === "sent"
              }
              onClick={() => send("reveal")}
            >
              {state === "signing"
                ? "Waiting on your wallet"
                : state === "sent"
                  ? "Validators are working"
                  : "Reveal my proposal"}
            </button>
            <TxNote state={state} message={message} hash={hash} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Transaction feedback, staged the way the brief asks for it.
 *
 * Sent shows the hash and says plainly that validators are working. Accepted
 * updates the record but keeps value language conditional. A failure shows the
 * contract's own sentence verbatim, because it was written for people.
 */
/**
 * Wrapped in a live region: the outcome of a commit or a reveal arrives
 * minutes after the button was pressed, and a change nobody announces is a
 * change a screen-reader user has no way to notice.
 */
function TxNote(props: { state: Phase; message: string; hash: string }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      <TxNoteBody {...props} />
    </div>
  );
}

function TxNoteBody({ state, message, hash }: { state: Phase; message: string; hash: string }) {
  if (state === "idle") return null;
  if (state === "sent") {
    return (
      <div className="note" style={{ marginTop: 14 }}>
        <strong>Sent.</strong> Validators are working on it. Nothing has changed on chain yet.
        <br />
        <span className="hash">{hash}</span>
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className="note" style={{ marginTop: 14 }}>
        <strong>Accepted.</strong> {message}
        <br />
        <span className="hash">{hash}</span>
      </div>
    );
  }
  if (state === "failed") {
    return (
      <div className="note note-warn" style={{ marginTop: 14 }}>
        <strong>Refused.</strong> {message}
        {hash ? (
          <>
            <br />
            <span className="hash">{hash}</span>
          </>
        ) : null}
      </div>
    );
  }
  if (state === "unknown") {
    return (
      <div className="note note-warn" style={{ marginTop: 14 }}>
        <strong>Outcome unclear.</strong> {message}
        {hash ? (
          <>
            <br />
            <span className="hash">{hash}</span>
          </>
        ) : null}
      </div>
    );
  }
  return null;
}
