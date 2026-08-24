"use client";

/**
 * Which wallet the app is talking to, decided once and used everywhere.
 *
 * The connect screen discovers wallets through EIP-6963 so that a button
 * labelled "Rabby" reaches Rabby. That care was wasted the moment the reader
 * left the screen: every other component went through `window.ethereum`, which
 * is whichever extension won the race to inject itself. With two wallets
 * installed you could connect as one address on the connect screen and then
 * seal a bid as a different one, and the commitment binds the bidder's address
 * - so the reveal would be refused by a contract that was right to refuse it.
 *
 * So the choice is recorded here, by `rdns`, and every caller resolves the
 * provider through this module.
 *
 * `rdns` rather than the announced `uuid`: a uuid is generated per page load,
 * so it identifies the announcement rather than the wallet, and would never
 * match again after a reload. `rdns` is the reverse-DNS name the wallet
 * controls and keeps.
 */

export type Eip1193 = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
};

export type ProviderInfo = { uuid: string; name: string; rdns: string; icon: string };
export type Announced = { info: ProviderInfo; provider: Eip1193 };

const KEY = "cachet:wallet-rdns";

/**
 * The wallet that only injects and never announces.
 *
 * Every current wallet implements EIP-6963, but an old install can still be
 * sitting on `window.ethereum` alone. It gets one sentinel so it can be
 * remembered like any other choice.
 */
export const LEGACY_RDNS = "legacy.window.ethereum";

/**
 * Collect the wallets announcing themselves in this browser.
 *
 * Listen first, then ask: wallets that already announced on page load
 * re-announce on `eip6963:requestProvider`, and asking first misses every
 * wallet that was ready before this ran, which is most of them.
 *
 * The wait is a real one rather than a microtask. Announcements are synchronous
 * in practice, but a slow extension can be a frame or two behind, and reporting
 * "no wallet" to somebody who has one is the worse mistake.
 */
let cached: Promise<Announced[]> | null = null;

export function discover(waitMs = 300): Promise<Announced[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  // One scan per page, shared by every caller.
  //
  // Each scan costs the full wait below, and the callers are not rare:
  // `chosenProvider` runs on every guarded header click, on every mount of
  // `useWallet`, again when it attaches its listeners, and once more for each
  // `walletClient`. Unshared, a single page load spent well over a second
  // waiting for announcements that had all arrived in the first frame.
  //
  // Safe to hold because extensions announce when they load and the set does
  // not change afterwards - installing one requires a reload, which clears
  // this along with everything else on the page.
  if (cached) return cached;
  cached = new Promise((resolve) => {
    const found: Announced[] = [];
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announced>).detail;
      if (!detail?.info?.rdns || !detail.provider) return;
      if (!found.some((f) => f.info.rdns === detail.info.rdns)) found.push(detail);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      // Nothing answered: do not cache that. A wallet that was still starting
      // up would otherwise be written off for the life of the page.
      if (found.length === 0) cached = null;
      resolve(found);
    }, waitMs);
  });
  return cached;
}

/** The announced wallets, plus a legacy entry ONLY when nothing announced. */
export async function wallets(waitMs?: number): Promise<Announced[]> {
  const announced = await discover(waitMs);
  if (announced.length > 0) return announced;
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!eth) return [];
  return [
    {
      // Deliberately not named from `isMetaMask`: wallets that are not MetaMask
      // set it too, and a guessed label is exactly what this module exists to
      // stop. "Browser wallet" is the honest description of what we have.
      info: { uuid: LEGACY_RDNS, name: "Browser wallet", rdns: LEGACY_RDNS, icon: "" },
      provider: eth,
    },
  ];
}

export function remember(rdns: string): void {
  try {
    window.localStorage.setItem(KEY, rdns);
  } catch {
    /* storage blocked; the choice lasts the page rather than the session */
  }
}

export function forget(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

export function chosenRdns(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * The provider for the remembered wallet, or null.
 *
 * Null when nothing was chosen, and null when the chosen wallet is no longer
 * present - an uninstalled extension must not silently become whichever wallet
 * replaced it.
 */
export async function chosenProvider(): Promise<Eip1193 | null> {
  const rdns = chosenRdns();
  if (!rdns) return null;
  if (rdns === LEGACY_RDNS) {
    return typeof window !== "undefined" ? (window.ethereum ?? null) : null;
  }
  const list = await discover();
  return list.find((w) => w.info.rdns === rdns)?.provider ?? null;
}

/**
 * Whether a wallet is connected right now.
 *
 * `eth_accounts` rather than `eth_requestAccounts`: it reports what has already
 * been authorised and never opens a prompt. A check that prompted would turn
 * every guarded link into a wallet popup, which is the opposite of asking
 * whether one is needed.
 */
export async function connectedAddress(): Promise<string | null> {
  const provider = await chosenProvider();
  if (!provider) return null;
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    // A locked wallet answers with an error. Locked is not connected.
    return null;
  }
}
