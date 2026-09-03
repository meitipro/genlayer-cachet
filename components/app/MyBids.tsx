"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import Stat from "./Stat";
import ViewHead from "./ViewHead";
import { useWallet } from "@/components/wallet";
import { formatGen, shortAddress } from "@/lib/format";
import type { BidderRecord } from "@/lib/types";

/**
 * The handoff's "My bids" pane.
 *
 * Client-side because the whole pane is about ONE address and the server does
 * not know which. Three states, kept apart on purpose: no wallet, could not
 * read, and a real record - including the real record that happens to be
 * empty, which is not the same as a failed read and must not look like one.
 *
 * The design's four figures are `made`, `sealed`, `won` and a win rate. The
 * rate is computed from rounds ENTERED rather than commitments made: a bidder
 * who amended twice made three commitments on one round, and dividing by that
 * would report a win rate that falls every time somebody corrects a typo.
 */
export default function MyBids() {
  const wallet = useWallet();
  const [record, setRecord] = useState<BidderRecord | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "failed">("idle");

  useEffect(() => {
    const address = wallet.address;
    if (!address) {
      setState("idle");
      setRecord(null);
      return;
    }
    let cancelled = false;
    setState("loading");
    fetch(`/api/bidder?address=${address}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: BidderRecord) => {
        if (cancelled) return;
        setRecord(data);
        setState("ok");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [wallet.address]);

  const head = (
    <ViewHead
      title="My bids"
      sub="Every round this address has entered, and where each one stands."
      actionLabel="Find a tender"
      actionHref="/rounds"
    />
  );

  if (!wallet.address) {
    return (
      <div className="shell view-pane">
        {head}
        <div className="panel">
          <div className="panel-body">
            <p className="empty-line">
              No wallet is connected, so there is no address to look up. This pane reads one
              address&rsquo;s own record - the docket itself is public and needs no wallet.
            </p>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <Link href="/?connect=1&to=/my-bids" className="btn btn-primary btn-small">
                Connect wallet
              </Link>
              <Link href="/rounds" className="btn btn-ghost btn-small">
                Open the docket
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === "loading" || state === "idle") {
    return (
      <div className="shell view-pane">
        {head}
        <div className="panel">
          <div className="panel-body">
            <p className="empty-line">Reading this address&rsquo;s record...</p>
          </div>
        </div>
      </div>
    );
  }

  if (state === "failed" || !record) {
    return (
      <div className="shell view-pane">
        {head}
        <div className="panel">
          <div className="panel-body">
            <p className="empty-line">
              This record could not be read, which is not a claim that the address has never
              bid. That is almost always the network&rsquo;s rate limit rather than anything
              wrong with the account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const winRate = record.entered > 0 ? Math.round((record.won / record.entered) * 100) : null;

  return (
    <div className="shell view-pane">
      {head}

      <div className="grid grid-auto-240 stat-grid">
        <Stat label="ROUNDS ENTERED" value={record.entered.toLocaleString("en-US")} />
        <Stat label="SEALED, NOT REVEALED" value={record.sealed.toLocaleString("en-US")} />
        <Stat label="AWARDED" value={record.won.toLocaleString("en-US")} />
        <Stat label="WIN RATE" value={winRate === null ? "-" : `${winRate}%`} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <span className="label">Your bids</span>
          <span className="label mono">{shortAddress(record.address)}</span>
        </div>
        <div className="panel-body">
          {record.rounds.length === 0 ? (
            <p className="empty-line">
              This address has not entered a round yet. Sealing a bid costs the entry deposit
              and returns it on reveal.
            </p>
          ) : (
            <ul className="mine-list">
              {record.rounds.map((r) => (
                <li key={r.id}>
                  <span className="mine-id mono">R{r.id}</span>
                  <span className="mine-title">{r.title}</span>
                  {r.mine ? (
                    <>
                      <span className={`mine-status s-${r.mine.status}`}>
                        {r.mine.status.toUpperCase()}
                        {r.mine.status === "scored" ? ` ${r.mine.total}` : ""}
                      </span>
                      <Link href={`/r/${r.id}/b/${r.mine.i}`} className="btn btn-ghost btn-small">
                        {r.mine.status === "scored" ? "Scorecard" : "View bid"}
                      </Link>
                      {/* The screen that can ACT, beside the one that reads.
                          This list is where a bidder comes looking for their
                          own bids, and it is where they will look to pull a
                          deposit or bond against a mark - so without this the
                          two value paths were reachable only by typing a URL
                          nothing on the site links to. */}
                      <Link href={`/bid/${r.id}`} className="btn btn-ghost btn-small">
                        {r.mine.status === "sealed" ? "Amend or open" : "Appeal or claim"}
                      </Link>
                    </>
                  ) : (
                    <>
                      <span className="mine-status">NO ROW</span>
                      <Link href={`/r/${r.id}`} className="btn btn-ghost btn-small">
                        Open round
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="panel-note">
            A sealed bid stores only a sha256 on chain, and that hash binds this address. The
            proposal is revealed after the commit window closes, and a reveal whose text does
            not hash to what was sealed is refused.
            {record.won > 0 ? (
              <>
                {" "}
                Awarded to this address so far: {formatGen(record.won_value)} GEN, net of the
                round fee.
              </>
            ) : null}
          </p>
        </div>
      </section>
    </div>
  );
}
