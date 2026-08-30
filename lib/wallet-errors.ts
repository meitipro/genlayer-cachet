import { shortAddress } from "./format.ts";

/**
 * Turning what a wallet says into what a reader can act on.
 *
 * This lives in `lib` rather than beside the wallet hook for one reason: it is
 * a pure function of an error object, and everything pure in this codebase is
 * tested. It reached a reader once as three copies of the same RPC sentence
 * with the only useful clause cut off mid-word, which is the kind of thing a
 * test catches and a code review does not.
 */

/**
 * The page and the wallet disagree about who is signing.
 *
 * Its own class so the message can name BOTH addresses, which is the whole
 * difference between "something went wrong" and a reader knowing which account
 * to switch back to.
 */
export class WalletAccountChanged extends Error {
  // Declared and assigned explicitly rather than as constructor parameter
  // properties: `node --test` runs these files by stripping types, and
  // stripping cannot synthesise the assignments a parameter property implies.
  // Everything in `lib` has to stay runnable that way.
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(
      `This page is acting as ${shortAddress(expected)} but your wallet is now on ` +
        `${shortAddress(actual)}. Switch back in your wallet, or disconnect and connect again ` +
        "with the account you want. Nothing was sent.",
    );
    this.name = "WalletAccountChanged";
    this.expected = expected;
    this.actual = actual;
  }
}

export function readableError(e: unknown): string {
  if (e instanceof WalletAccountChanged) return e.message;

  const err = e as { code?: number; shortMessage?: string; details?: string; message?: string };
  if (err?.code === 4001) return "You rejected the request in your wallet.";

  // viem stacks its own summary on top of the wallet's, so `details`,
  // `shortMessage` and `message` routinely repeat each other word for word.
  // Joining them blindly is what produced "Invalid parameters were provided to
  // the RPC method. Double check you have provided the correct parameters."
  // twice in one line, with the clause that actually said something pushed
  // past the length limit. Keep a part only when it adds something.
  const parts: string[] = [];
  for (const p of [err?.details, err?.shortMessage, err?.message]) {
    const part = String(p ?? "").trim();
    if (!part) continue;
    if (parts.some((kept) => kept.includes(part) || part.includes(kept))) continue;
    parts.push(part);
  }
  const text = parts.join(" - ") || String(e);

  // THE ACCOUNT THE WALLET IS ACTUALLY ON.
  //
  // Rabby compares a transaction's `from` against the account it currently has
  // selected, not against the account it reported to this site. Switch the
  // active account in the extension and `eth_accounts` still answers with the
  // one this site was connected with, so nothing on the page looks wrong until
  // a write is refused - by a message that names neither address nor a remedy.
  if (/from should be same as current|from.*not.*current account/i.test(text)) {
    return (
      "Your wallet is on a different account than the one this site is connected with. " +
      "Switch back to the address shown in the header, or disconnect and connect again " +
      "with the account you want to use. Nothing was sent."
    );
  }
  if (/rate limit/i.test(text)) {
    return "The network is rate limiting requests right now. Wait a minute and try again - nothing was sent.";
  }
  if (/insufficient/i.test(text)) return "That account does not hold enough GEN for this call.";

  // Cut on a word boundary. A message that ends mid-word reads as a bug in
  // this page rather than as a long message from somewhere else.
  if (text.length <= 300) return text;
  const cut = text.slice(0, 300);
  const space = cut.lastIndexOf(" ");
  return space > 200 ? cut.slice(0, space) : cut;
}
