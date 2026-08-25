/**
 * The connected account's balance, and the faucet beside it.
 *
 * This matters more here than on most GenLayer apps. Sealing a bid costs an
 * ENTRY DEPOSIT - five GEN by default - and appealing costs a bond on top. An
 * account at zero cannot commit at all, so a bidder who arrives without funds
 * hits a refusal they have no way to resolve from inside the site. The faucet
 * is what closes that.
 *
 *   balance   `eth_getBalance`. It answers `0x0` for an address the ledger has
 *             never seen, which is a true zero rather than a failure.
 *   faucet    `sim_fundAccount`, Studio's programmatic faucet. Bradbury has no
 *             such method, so there the button becomes a link to the real
 *             faucet page - the honest equivalent rather than a dead control.
 *
 * THREE MEASURED FACTS about `sim_fundAccount`, each of which becomes a bug if
 * you trust the call instead of the ledger:
 *
 *  1. It CREDITS THE ACCOUNT AND THEN ERRORS when the amount is a hex string,
 *     answering `-32603  '<=' not supported between instances of 'str' and
 *     'int'` while the balance goes up by the full amount. So the amount is
 *     sent as a JSON number, and that specific error is never reported as
 *     "nothing happened" - a retry loop on it funds the account again each
 *     time round.
 *  2. 100 GEN is 1e20 wei, past `Number.MAX_SAFE_INTEGER` but still exact in a
 *     float64 (it is 2^20 x 5^20). Any amount is checked for that before it is
 *     sent rather than assumed.
 *  3. It ANSWERS WITH A TRANSACTION HASH FOR AN ADDRESS STUDIO DOES NOT HOLD,
 *     and credits nothing. A hash from this method is therefore not evidence
 *     of a credit, and no caller may report one as if it were. The balance is
 *     read before and after, and the message says whichever is true.
 */

import { CHAIN, IS_STUDIO, RPC_URL } from "./chain";

export const DECIMALS = CHAIN.nativeCurrency?.decimals ?? 18;
export const SYMBOL = CHAIN.nativeCurrency?.symbol ?? "GEN";

/** Studio is the only network with a faucet this app can call itself. */
export const HAS_PROGRAMMATIC_FAUCET = IS_STUDIO;

/**
 * What one press asks for.
 *
 * Sized against what the product actually costs: a default entry deposit is
 * five GEN and an appeal bond ten, so a hundred covers a bidder for a dozen
 * rounds without them coming back to the tap between every commit.
 */
export const FAUCET_GEN = 100;

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message || "The node refused the request.");
  return json.result;
}

/** Wei held by an address, or null when the node did not answer. */
export async function balanceOf(address: string): Promise<bigint | null> {
  try {
    const raw = await rpc("eth_getBalance", [address, "latest"]);
    if (typeof raw !== "string") return null;
    return BigInt(raw);
  } catch {
    return null;
  }
}

/**
 * `1,240.5` - a balance at the precision a person reads.
 *
 * A dust balance reads `under 0.001` rather than rounding to `0`, so nobody
 * concludes the faucet did nothing when it did something small.
 */
export function formatUnits(wei: bigint): string {
  const base = 10n ** BigInt(DECIMALS);
  const whole = wei / base;
  const rest = wei % base;
  if (rest === 0n) return whole.toLocaleString("en-US");
  const thousandths = (rest * 1000n) / base;
  if (whole === 0n && thousandths === 0n) return "under 0.001";
  const fraction = thousandths.toString().padStart(3, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}.${fraction || "0"}`;
}

export type FaucetResult = { hash: string } | { credited: true };

/**
 * Ask Studio for testnet GEN.
 *
 * The `credited` shape is fact 1 above: the node raised an error of a kind
 * that is only ever thrown AFTER the credit lands, so the caller refreshes the
 * balance rather than inviting somebody to press again.
 */
export async function requestFunds(address: string, gen = FAUCET_GEN): Promise<FaucetResult> {
  if (!HAS_PROGRAMMATIC_FAUCET) {
    throw new Error("This network has no faucet this page can call.");
  }
  const wei = BigInt(gen) * 10n ** BigInt(DECIMALS);
  // The amount crosses the wire as a JSON number, so it has to survive the
  // round trip through a float exactly. 1e20 does; 1e20 + 1 would not, and
  // would fund a different amount than the one printed on the button.
  if (BigInt(Number(wei)) !== wei) {
    throw new Error("That amount cannot be sent exactly, so it was not sent at all.");
  }
  try {
    const hash = await rpc("sim_fundAccount", [address, Number(wei)]);
    return { hash: typeof hash === "string" ? hash : "" };
  } catch (error) {
    const message = String((error as Error)?.message ?? "");
    if (message.includes("'<=' not supported")) return { credited: true };
    throw error;
  }
}
