"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

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
import { formatDate, humanError, shortAddress } from "@/lib/format";
import { LIMITS } from "@/lib/limits";
import type { Question } from "@/lib/types";

/**
 * Public clarifications on a frozen tender.
 *
 * The criteria cannot change - that is the guarantee everything else rests on.
 * But a frozen criterion can still be ambiguous, and when it is, every bidder
 * resolves the ambiguity privately and differently, so the scores end up
 * measuring who guessed the buyer's intent rather than who is best placed to
 * do the work.
 *
 * So the clarification happens here, in the open, on chain, with a timestamp.
 * Everyone reads the same answer and nobody can be told something the others
 * were not.
 */
export default function Clarifications({
  roundId,
  buyer,
  questions,
  open,
}: {
  roundId: number;
  buyer: string;
  questions: Question[] | null;
  /** True while the commit window is open, which is when questions are taken. */
  open: boolean;
}) {
  const router = useRouter();
  const { address, chainOk, busy, error, connect, network } = useWallet();
  const [text, setText] = useState("");
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<string>("");
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);

  const isBuyer = Boolean(address && address.toLowerCase() === buyer.toLowerCase());

  const send = useCallback(
    async (fn: "ask" | "answer", args: unknown[], key: string, done: string) => {
      if (!address) return;
      setPending(key);
      setNote("");
      setFailed(false);
      try {
        const client = await walletClient(address);
        const hash = (await client.writeContract({
          address: CONTRACT,
          functionName: fn,
          args: args as never[],
          value: 0n,
        })) as string;
        const receipt = await waitAccepted(client, hash);
        const outcome = executionOf(receipt);
        if (outcome === "SUCCESS") {
          setNote(done);
          if (fn === "ask") setText("");
          // The list above is server-rendered, so without this the question or
          // answer that was just accepted stays invisible until the reader
          // reloads - on the one screen whose whole job is showing that list.
          // `refresh` re-runs the server component and keeps the form state.
          router.refresh();
        } else if (outcome === "ERROR") {
          setFailed(true);
          setNote(humanError(refusalOf(receipt)) || "The contract refused the call.");
        } else {
          // Neither answer is available from the receipt. Saying "refused"
          // invites a duplicate; saying "posted" might be false.
          setFailed(true);
          setNote(
            "The transaction settled but its outcome could not be read. Reload before sending it again - it may already have landed.",
          );
        }
      } catch (e) {
        setFailed(true);
        setNote(readableError(e));
      } finally {
        setPending("");
      }
    },
    [address, router],
  );

  const list = questions ?? [];
  const unanswered = list.filter((q) => !q.answer).length;

  return (
    <div className="stack">
      <div className="eyebrow-row">
        <div className="eyebrow">Clarifications</div>
        <div className="eyebrow-note">
          {questions === null
            ? "could not be read"
            : list.length === 0
              ? open
                ? "none asked yet"
                : "none were asked"
              : `${list.length} asked - ${unanswered} unanswered`}
        </div>
      </div>

      <p className="help" style={{ maxWidth: "76ch", marginTop: -18 }}>
        Questions and answers are public and permanent, and they close with the commit window - an
        answer arriving after commitments were sealed would be information only the bidders who
        waited could act on. <strong>An answer explains what a criterion means; it does not
        change what is scored.</strong> The network is given the frozen criteria and nothing else.
      </p>

      {questions === null ? (
        <div className="empty">
          <p>
            The clarifications on this round could not be read, so this is not a claim that none
            were asked.
          </p>
        </div>
      ) : list.length === 0 && !open ? (
        <div className="empty">
          <p>No question was asked on this round before the commit window closed.</p>
        </div>
      ) : null}

      {list.map((q) => (
        <div className="panel" key={q.i}>
          <div className="panel-head">
            <span className="label">
              Q{q.i + 1} - {shortAddress(q.asker)}
            </span>
            <span className="label">{formatDate(q.asked_at, true)}</span>
          </div>
          <div className="panel-body">
            <p style={{ fontSize: 15, lineHeight: 1.55, margin: 0 }}>{q.text}</p>

            {q.answer ? (
              <div className="answer">
                <div className="label" style={{ marginBottom: 8 }}>
                  The buyer answered {formatDate(q.answered_at, true)}
                </div>
                <p style={{ fontSize: 15, lineHeight: 1.55, margin: 0 }}>{q.answer}</p>
              </div>
            ) : isBuyer && open && chainOk ? (
              <div style={{ marginTop: 14 }}>
                <label className="field">
                  <span className="label">Your answer, published to every bidder at once</span>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 110 }}
                    value={replies[q.i] ?? ""}
                    maxLength={LIMITS.answerMax}
                    onChange={(e) => setReplies((r) => ({ ...r, [q.i]: e.target.value }))}
                    placeholder="Answer once. It cannot be revised afterwards."
                  />
                </label>
                <button
                  className="btn btn-primary btn-small"
                  disabled={!(replies[q.i] ?? "").trim() || pending === `a${q.i}`}
                  onClick={() => send("answer", [roundId, q.i, replies[q.i]], `a${q.i}`, "Answered.")}
                >
                  {pending === `a${q.i}` ? "Publishing" : "Publish this answer"}
                </button>
              </div>
            ) : isBuyer && open ? (
              <p className="help" style={{ marginTop: 10 }}>
                This is your tender to answer. Switch to {network} to publish a reply.
              </p>
            ) : (
              <p className="help" style={{ marginTop: 10 }}>
                {open ? "Waiting on the buyer." : "This question was never answered."}
              </p>
            )}
          </div>
        </div>
      ))}

      {open ? (
        <div className="panel">
          <div className="panel-head">
            <span className="label">Ask the buyer</span>
            <span className="label">{network}</span>
          </div>
          <div className="panel-body">
            {!address ? (
              <>
                <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", marginBottom: 14 }}>
                  Anyone may ask, whether or not they have sealed a bid - the answer is public
                  either way, and needing to pay a deposit to find out what a criterion means
                  would defeat the point.
                </p>
                <button className="btn btn-primary" onClick={connect} disabled={busy}>
                  {busy ? "Connecting" : "Connect a wallet"}
                </button>
              </>
            ) : !chainOk ? (
              <div className="note note-warn">
                <strong>Wrong network.</strong> Switch to {network} to ask a question.
                <br />
                <button className="btn btn-ghost btn-small" onClick={connect} style={{ marginTop: 10 }}>
                  Switch network
                </button>
              </div>
            ) : (
              <>
                <label className="field">
                  <span className="label">
                    Your question - {LIMITS.questionMin} to {LIMITS.questionMax} characters
                  </span>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 110 }}
                    value={text}
                    maxLength={LIMITS.questionMax}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Ask about something a criterion leaves open. Everyone will see the question and the answer."
                  />
                </label>
                <p className="help" style={{ marginTop: -10, marginBottom: 14 }}>
                  {text.trim().length} of {LIMITS.questionMax} characters. At most{" "}
                  {LIMITS.asksPerAddress} questions per address on a round.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={text.trim().length < LIMITS.questionMin || pending === "ask"}
                  onClick={() => send("ask", [roundId, text], "ask", "Asked, in public.")}
                >
                  {pending === "ask" ? "Publishing" : "Ask in public"}
                </button>
              </>
            )}
            {error ? <p className="error">{error}</p> : null}
          </div>
        </div>
      ) : null}

      {/* One live region for both actions: the outcome arrives long after the
          button was pressed, and a change nobody announces is a change a
          screen-reader user has no way to notice. */}
      <div aria-live="polite" aria-atomic="true">
        {note ? (
          <div className={failed ? "note note-warn" : "note"}>
            {failed ? <strong>Refused. </strong> : <strong>Done. </strong>}
            {note}
          </div>
        ) : null}
      </div>

      {!CONTRACT_CONFIGURED ? (
        <div className="note">
          <strong>No contract is configured for {network}.</strong> There is nothing to ask
          against.
        </div>
      ) : null}
    </div>
  );
}
