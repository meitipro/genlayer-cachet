"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "genlayer-js";

import { ADD_CHAIN_PARAMS, CACHET, CHAIN, CHAIN_ID_HEX, IS_LIVE, NETWORK_LABEL } from "@/lib/chain";
import { chosenProvider, chosenRdns, forget, remember, wallets } from "./providers";
import { balanceOf } from "@/lib/funds";

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

/**
 * The connected account, on the wallet the reader actually chose.
 *
 * ONE instance of this runs, inside `WalletProvider` at the bottom of this
 * file, and every component reads that shared state through `useWallet`.
 *
 * It used to be a plain hook that each consumer called for itself, which
 * meant each kept its own copy of the answer and they drifted apart.
 * Measured: the bid panel discovered the wallet and reported the address
 * while the header chip, whose own scan had run a moment earlier and found
 * nothing, still offered "Connect wallet" on the same screen. Four
 * independent scans also meant four rounds of EIP-6963 discovery and four
 * `eth_accounts` calls per page, against a node that allows thirty requests
 * a minute.
 *
 * Every provider call here goes through `chosenProvider()` rather than
 * `window.ethereum`. The two are not the same thing when more than one wallet
 * is installed, and the difference is an address: a bid is committed as a hash
 * that binds the bidder's own address, so signing the reveal from a different
 * wallet produces a commitment mismatch the contract is right to refuse.
 */
function useWalletEngine() {
  const router = useRouter();
  const pathname = usePathname();
  const [address, setAddress] = useState<string | null>(null);
  const [chainOk, setChainOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Wei, or null when it has not been read or the node did not answer. */
  const [balance, setBalance] = useState<bigint | null>(null);

  const refresh = useCallback(async () => {
    const eth = await chosenProvider();
    if (!eth) {
      // No wallet chosen, or the chosen one is gone. Report disconnected rather
      // than falling back to another wallet's accounts.
      setAddress(null);
      setChainOk(false);
      return;
    }
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
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      await refresh();
      const eth = await chosenProvider();
      // The listeners have to go on the SAME provider we read from, or a
      // wallet switch in one extension would refresh an account read from
      // another.
      if (cancelled || !eth?.on) return;
      const onAccounts = () => refresh();
      const onChain = () => refresh();
      eth.on("accountsChanged", onAccounts);
      eth.on("chainChanged", onChain);
      stop = () => {
        eth.removeListener?.("accountsChanged", onAccounts);
        eth.removeListener?.("chainChanged", onChain);
      };
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    setError("");
    let eth = await chosenProvider();
    if (!eth) {
      // Nothing chosen yet. With exactly one wallet installed there is no
      // ambiguity, so connect it and remember it. With several, the choice is
      // the reader's to make and the connect screen is where it is offered.
      const found = await wallets();
      if (found.length === 0) {
        setError("No browser wallet found. Install one, then reload this page.");
        return;
      }
      if (found.length > 1) {
        // Send them to the one screen that can ask, and bring them back.
        //
        // This used to set an error reading "choose one from the connect
        // screen", which was a dead end: the connect step lives on the landing
        // and there is no way to reach it from here. Anyone arriving straight
        // at this page - a shared link, a bookmark, cleared site data - with
        // two wallets installed had a button that could only ever fail.
        router.push(`/?connect=1&to=${encodeURIComponent(pathname || "/rounds")}`);
        return;
      }
      remember(found[0].info.rdns);
      eth = found[0].provider;
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
  }, [refresh, router, pathname]);

  /**
   * Ask the wallet to move to this chain, then READ THE CHAIN BACK.
   *
   * A successful `wallet_switchEthereumChain` is normally followed by a
   * `chainChanged` event and the listener above picks it up. Normally. EIP-1193
   * does not guarantee it, wallets differ on whether they fire it for a switch
   * they were asked for, and there is a race either way. When it does not
   * arrive the switch really happened and the screen still says wrong network -
   * somebody presses the button, watches their wallet change, and sees nothing
   * move here. One extra idempotent call closes that.
   */
  const switchChain = useCallback(async (): Promise<boolean> => {
    const eth = await chosenProvider();
    if (!eth) return false;
    setError("");
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
      await refresh();
      return true;
    } catch (e) {
      if ((e as { code?: number })?.code === 4902) {
        try {
          await eth.request({ method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] });
          await refresh();
          return true;
        } catch (addError) {
          setError(readableError(addError));
          return false;
        }
      }
      setError(readableError(e));
      return false;
    }
  }, [refresh]);

  /**
   * Stop using the account here.
   *
   * EIP-1193 has no revoke. This forgets the choice on our side; the wallet
   * keeps its permission until it is removed there, and the button copy says
   * so rather than implying more than it does.
   */
  const disconnect = useCallback(() => {
    forget();
    setAddress(null);
    setChainOk(false);
    setBalance(null);
    setError("");
  }, []);

  /**
   * Keep listening for wallets after the first scan.
   *
   * Discovery runs once when this mounts and waits a fixed moment for
   * announcements. An extension that is still starting up misses that window,
   * and with a single shared state there is nothing else that would ever look
   * again - the reader would see "Connect wallet" for a wallet that is sitting
   * right there, until they reloaded.
   *
   * So an announcement matching the remembered choice re-runs the read. It
   * costs nothing when no wallet announces late, which is the common case.
   */
  const caughtLate = useRef(false);
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const info = (event as CustomEvent<{ info?: { rdns?: string } }>).detail?.info;
      if (!info?.rdns) return;
      if (info.rdns !== chosenRdns()) return;

      /**
       * Once only, and only while nothing is connected.
       *
       * EIP-6963 says a wallet re-announces whenever a page dispatches
       * `requestProvider`, and `refresh` dispatches exactly that on its way to
       * resolving the provider. Refreshing on every announcement therefore
       * feeds itself: announce, refresh, request, announce. Measured before
       * this guard - twenty-one rounds of `eth_accounts` and `eth_chainId`
       * from a single late announcement, against a node that allows thirty
       * requests a minute.
       */
      if (caughtLate.current || address) return;
      caughtLate.current = true;
      void refresh();
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, [refresh, address]);

  const refreshBalance = useCallback(async () => {
    if (!address) {
      setBalance(null);
      return;
    }
    setBalance(await balanceOf(address));
  }, [address]);

  /* Read it whenever the account or the network changes. */
  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance, chainOk]);

  return {
    address,
    chainOk,
    busy,
    error,
    connect,
    refresh,
    balance,
    refreshBalance,
    switchChain,
    disconnect,
    network: NETWORK_LABEL,
  };
}

/**
 * Passing createClient a bare ADDRESS rather than a private key puts
 * genlayer-js into browser-wallet mode: it routes `eth_sendTransaction` to an
 * EIP-1193 provider and the user signs in their wallet. Handing it a key here
 * would mean the page held one, which it must never do.
 *
 * The provider is passed EXPLICITLY, and that is the point. Left out, the SDK
 * falls back to `window.ethereum` - `getCustomTransportConfig` reads
 * `config.provider || window.ethereum` - which is whichever extension won the
 * race to inject itself, not the wallet the reader picked on the connect
 * screen. With two installed, the app would show one address and sign with
 * another, and since a commitment hash binds the bidder's own address, the
 * reveal would then be refused by a contract that was right to refuse it.
 *
 * Async because resolving the chosen wallet means asking the browser which
 * wallets are announcing.
 */
export async function walletClient(address: string) {
  const provider = await chosenProvider();
  return createClient({
    chain: CHAIN,
    account: address as `0x${string}`,
    // Cast: the SDK brands its provider type, and re-deriving that brand here
    // would couple this file to the SDK's internals for no runtime benefit.
    ...(provider ? { provider: provider as never } : {}),
  });
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
export async function waitAccepted(
  client: Awaited<ReturnType<typeof walletClient>>,
  hash: string,
) {
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

/* ==========================================================================
   The shared instance
   ========================================================================== */

type WalletState = ReturnType<typeof useWalletEngine>;

const WalletContext = createContext<WalletState | null>(null);

/**
 * Wraps the app so there is exactly one wallet state.
 *
 * Mounted in the root layout rather than per route group: the landing's
 * connect step and the dashboard's chip have to agree with each other, and a
 * provider covering only one of them would recreate the drift it exists to
 * remove.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const value = useWalletEngine();
  return createElement(WalletContext.Provider, { value }, children);
}

/**
 * The shared wallet state.
 *
 * Throws outside the provider rather than quietly returning a disconnected
 * shape: a component reading "no wallet" because it was mounted in the wrong
 * tree is a bug that looks exactly like a reader who has no wallet.
 */
export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet was called outside WalletProvider.");
  return value;
}
