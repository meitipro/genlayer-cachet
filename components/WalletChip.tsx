"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { FAUCET_URL, NETWORK_LABEL } from "@/lib/chain";
import {
  FAUCET_GEN,
  HAS_PROGRAMMATIC_FAUCET,
  SYMBOL,
  balanceOf,
  formatUnits,
  requestFunds,
} from "@/lib/funds";
import { shortAddress } from "@/lib/format";
import { readableError, useWallet } from "./wallet";

/**
 * Who is signing, on what network, with what balance - and the faucet.
 *
 * Four states, because collapsing them is how a wallet control starts lying:
 *
 *   not connected  the one action, and it goes to the screen that asks WHICH
 *                  wallet rather than grabbing whatever injected itself
 *   wrong network  the address is real but a write would fail, so it names the
 *                  network wanted and offers the switch
 *   connected      the address, the balance, the faucet, and forget behind a
 *                  menu
 *   no contract    nothing to sign against, so the chip stays out of the way
 *
 * The faucet earns its place on this product specifically: sealing a bid costs
 * an entry deposit and appealing costs a bond, so an account at zero cannot
 * take part at all. Without a tap on the page, a bidder meets a refusal they
 * cannot resolve from inside the site.
 */
export default function WalletChip() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [funding, setFunding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const wrap = useRef<HTMLDivElement | null>(null);

  /* A menu opened from the keyboard has to be closable from it. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = useCallback(async () => {
    if (!wallet.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused outright. Say so rather than showing a
      // tick for something that did not happen.
      setNote("This browser would not let the page copy. Select the address instead.");
    }
  }, [wallet.address]);

  /**
   * Ask for testnet GEN, then report what the LEDGER says.
   *
   * `sim_fundAccount` answers with a transaction hash for an address Studio has
   * never held, and credits nothing - so a hash is not a receipt. The balance
   * is read before and after and the message is derived from the difference.
   * Studio settles funding in a second or two rather than instantly, so a flat
   * reading is re-checked a few times before it is believed.
   */
  const faucet = useCallback(async () => {
    if (!wallet.address || funding) return;
    const address = wallet.address;
    setFunding(true);
    setNote("");
    try {
      // NOT `?? 0n`. A failed pre-read is not a zero balance, and treating it
      // as one made every later reading look like a credit: `after > before`
      // is true for any funded account the moment the node answers again, so
      // the chip would report GEN arriving that the faucet never sent.
      const before = await balanceOf(address);
      await requestFunds(address, FAUCET_GEN);

      let after = before;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (before !== null && after !== null && after > before) break;
        await new Promise((r) => setTimeout(r, 1200));
        const reading = await balanceOf(address);
        if (reading !== null) after = reading;
      }
      await wallet.refreshBalance();

      setNote(
        before === null || after === null
          ? `The faucet accepted the request. This balance could not be read, so whether it moved is not something this page can tell you - check your wallet.`
          : after > before
            ? `${formatUnits(after - before)} ${SYMBOL} credited.`
            : `The faucet accepted the request, but this balance has not moved. ${NETWORK_LABEL} only funds accounts its ledger already knows.`,
      );
    } catch (e) {
      setNote(readableError(e));
    } finally {
      setFunding(false);
    }
  }, [funding, wallet]);

  /* ---- not connected -------------------------------------------------- */
  if (!wallet.address) {
    return (
      <Link href="/?connect=1&to=/rounds" className="btn btn-primary btn-small wallet-connect">
        Connect wallet
      </Link>
    );
  }

  /* ---- wrong network -------------------------------------------------- */
  if (!wallet.chainOk) {
    return (
      <button
        type="button"
        className="btn btn-small wallet-wrong"
        onClick={() => void wallet.switchChain()}
        disabled={wallet.busy}
      >
        Switch to {NETWORK_LABEL}
      </button>
    );
  }

  /* ---- connected ------------------------------------------------------ */
  return (
    <div ref={wrap} className="wallet-wrap">
      <button
        type="button"
        className="btn btn-ghost btn-small wallet-chip"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="wallet-dot" aria-hidden="true" />
        <span className="mono">{shortAddress(wallet.address)}</span>
        {wallet.balance !== null ? (
          <span className="wallet-bal mono">
            {formatUnits(wallet.balance)} {SYMBOL}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="wallet-menu" role="menu">
          <div className="wallet-menu-addr mono">{wallet.address}</div>

          <div className="wallet-menu-row">
            <span className="wallet-menu-label">Network</span>
            <span className="mono wallet-menu-value">{NETWORK_LABEL}</span>
          </div>
          <div className="wallet-menu-row">
            <span className="wallet-menu-label">Balance</span>
            <span className="mono wallet-menu-value">
              {wallet.balance === null ? "not read" : `${formatUnits(wallet.balance)} ${SYMBOL}`}
            </span>
          </div>

          <div className="wallet-menu-actions">
            <button type="button" role="menuitem" className="btn btn-ghost btn-small" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy address"}
            </button>

            {/* Studio has a faucet this page can call. Bradbury does not, so
                there the same affordance becomes a link to the real one rather
                than a button that cannot work. */}
            {HAS_PROGRAMMATIC_FAUCET ? (
              <button
                type="button"
                role="menuitem"
                className="btn btn-small btn-primary"
                onClick={() => void faucet()}
                disabled={funding}
              >
                {funding ? "Asking..." : `Faucet ${FAUCET_GEN} ${SYMBOL}`}
              </button>
            ) : FAUCET_URL ? (
              <a
                role="menuitem"
                className="btn btn-small btn-primary"
                href={FAUCET_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open the faucet
              </a>
            ) : null}
          </div>

          <p className="wallet-menu-why">
            Sealing a bid costs an entry deposit and an appeal costs a bond, so an account at
            zero cannot take part.
          </p>

          {note ? <p className="wallet-menu-note">{note}</p> : null}

          <button
            type="button"
            role="menuitem"
            className="btn btn-ghost btn-small"
            onClick={() => {
              wallet.disconnect();
              setOpen(false);
            }}
          >
            Forget this account
          </button>
          <p className="wallet-menu-why">
            This site stops using the account. The wallet keeps its permission until you remove
            it there.
          </p>
        </div>
      ) : null}
    </div>
  );
}
