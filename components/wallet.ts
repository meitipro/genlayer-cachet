"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "genlayer-js";

import { ADD_CHAIN_PARAMS, CACHET, CHAIN, CHAIN_ID_HEX, IS_LIVE, NETWORK_LABEL } from "@/lib/chain";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export type TxPhase = "idle" | "signing" | "sent" | "accepted" | "finalized" | "failed";

export type TxState = {
  phase: TxPhase;
  hash?: string;
  /** The contract's own refusal sentence, written to be read by people. */
  message?: string;
};

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainOk, setChainOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const eth = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!eth) return;
    try {
      const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
      setAddress(accounts?.[0] ?? null);
      const id = (await eth.request({ method: "eth_chainId" })) as string;
      setChainOk(String(id).toLowerCase() === CHAIN_ID_HEX.toLowerCase());
    } catch {
      /* a locked wallet answers with an error; not worth surfacing */
    }
  }, []);

  useEffect(() => {
    refresh();
    const eth = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!eth?.on) return;
    const onAccounts = () => refresh();
    const onChain = () => refresh();
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    setError("");
    const eth = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!eth) {
      setError("No browser wallet found. Install one, then reload this page.");
      return;
    }
    setBusy(true);
    try {
      await eth.request({ method: "eth_requestAccounts" });
      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAIN_ID_HEX }],
        });
      } catch (switchError) {
        // 4902: the wallet has never heard of this chain. Adding it is the
        // only way forward, and it is the same object lib/chain.ts derives
        // from the SDK, so it cannot drift from what the client talks to.
        if ((switchError as { code?: number })?.code === 4902) {
          await eth.request({ method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] });
        } else {
          throw switchError;
        }
      }
      await refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { address, chainOk, busy, error, connect, refresh, network: NETWORK_LABEL };
}

/**
 * Passing createClient a bare ADDRESS rather than a private key puts
 * genlayer-js into browser-wallet mode: it routes eth_sendTransaction through
 * window.ethereum and the user signs in their wallet. Handing it a key here
 * would mean the page held one, which it must never do.
 */
export function walletClient(address: string) {
  return createClient({ chain: CHAIN, account: address as `0x${string}` });
}

/**
 * Wait for a write to be ACCEPTED, not FINALIZED.
 *
 * Records and status changes in this contract act on acceptance - deliberately,
 * so a bidder can read their scorecard during the appeal window - and views
 * read the latest non-final state. Acceptance is therefore the moment a change
 * becomes visible, and making a bidder watch a spinner until finality would be
 * waiting for something that already happened.
 *
 * The interval is eight seconds because Studio rate limits at 30 requests a
 * minute across the whole IP. Polling faster does not make consensus quicker,
 * it just spends the budget the rest of the page needs.
 *
 * The `never` casts are load-bearing only in the type system: genlayer-js
 * brands its hash and status types, and re-deriving those brands here would
 * couple this file to the SDK's internals for no runtime benefit.
 */
export async function waitAccepted(client: ReturnType<typeof walletClient>, hash: string) {
  return client.waitForTransactionReceipt({
    hash: hash as never,
    status: "ACCEPTED" as never,
    interval: 8000,
    retries: 120,
  });
}

export function readableError(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; details?: string; message?: string };
  if (err?.code === 4001) return "You rejected the request in your wallet.";
  const parts = [err?.details, err?.shortMessage, err?.message].filter(Boolean) as string[];
  const text = parts.join(" - ") || String(e);
  if (/rate limit/i.test(text)) {
    return "The network is rate limiting requests right now. Wait a minute and try again - nothing was sent.";
  }
  if (/insufficient/i.test(text)) return "That account does not hold enough GEN for this call.";
  return text.slice(0, 300);
}

type LeaderRound = {
  mode?: string;
  execution_result?: string;
  result?: { status?: string; payload?: string };
};

/**
 * The round that actually executed the contract.
 *
 * `consensus_data.leader_receipt` is an ARRAY, and index 0 is not reliably the
 * leader - later entries are validators, whose `execution_result` is routinely
 * `ERROR` with "Validator execution cancelled after quorum". Reading index 0,
 * or scanning for the first ERROR, therefore reports a cancelled validator as
 * though it were the contract's own answer, and shows that sentence to a
 * bidder as the reason their bid failed.
 *
 * Select on `mode === "leader"`, and fall back to the first entry only when no
 * entry declares a mode at all.
 */
function leaderRound(receipt: unknown): LeaderRound | null {
  const r = receipt as { consensus_data?: { leader_receipt?: unknown } };
  const raw = r?.consensus_data?.leader_receipt;
  const list: LeaderRound[] = Array.isArray(raw) ? raw : raw ? [raw as LeaderRound] : [];
  if (!list.length) return null;
  return list.find((entry) => entry?.mode === "leader") ?? list[0] ?? null;
}

export type Execution = "SUCCESS" | "ERROR" | "UNKNOWN";

/**
 * What the CONTRACT did - not what the transaction did.
 *
 * `receipt.status` says FINALIZED for a refused call and `receipt.result` says
 * MAJORITY_AGREE, because validators agreeing that a call failed is still
 * agreement. Only `execution_result` answers the question.
 *
 * Returns UNKNOWN rather than guessing when the receipt has no leader round.
 * Callers must not treat that as either outcome: reporting success would hand
 * someone a confirmation for a bid that was refused, and reporting failure
 * would invite them to submit - and pay - a second time.
 */
export function executionOf(receipt: unknown): Execution {
  const round = leaderRound(receipt);
  if (!round) return "UNKNOWN";
  const value = round.execution_result;
  if (value === "SUCCESS") return "SUCCESS";
  if (value === "ERROR") return "ERROR";
  return "UNKNOWN";
}

/**
 * The refusal sentence the contract wrote for a person to read.
 *
 * Plain text at the leader round's `result.payload`, beside a `result.status`
 * of "rollback" (`gl.advanced.user_error_immediate`) or "contract_error" (a
 * raised `gl.vm.UserError`). `genvm_result.stderr` is EMPTY for a clean
 * refusal, so "no error output" is exactly what a working refusal looks like.
 *
 * Read only from the leader round, and only when it errored: a successful
 * round carries a payload too - its encoded return value - and printing that
 * as a reason would be nonsense.
 */
export function refusalOf(receipt: unknown): string {
  const round = leaderRound(receipt);
  if (!round || round.execution_result !== "ERROR") return "";
  const payload = round.result?.payload;
  return typeof payload === "string" ? payload.trim() : "";
}

export const CONTRACT = CACHET;
export const CONTRACT_CONFIGURED = IS_LIVE;
