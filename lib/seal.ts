/**
 * The sealed commitment, computed in the browser.
 *
 * This file is the browser half of a two-implementation agreement. The other
 * half is `commitment_for` in `contracts/cachet.py`, and the two must produce
 * the same 64 characters for the same inputs or every reveal on the site is
 * refused - the contract recomputes the digest from the revealed text and
 * compares it to what was committed.
 *
 * It lives here, apart from the panel that calls it, so that agreement can be
 * tested. `lib/seal.test.ts` checks it against digests produced by the Python
 * side, including the cases where the two languages could plausibly disagree:
 * multi-byte characters, embedded newlines, and address casing.
 */
import { LIMITS } from "./limits.ts";

/**
 * Exactly `"%s\n%s\n%s" % (salt, bidder.lower(), proposal)`.
 *
 * The address is lowercased on both sides. A wallet hands back an EIP-55
 * checksummed address while the contract stores whatever it was given, so
 * hashing the address as-typed would make a commitment openable only from the
 * casing that happened to create it.
 */
export function sealPayload(salt: string, bidder: string, proposal: string): string {
  return `${salt}\n${bidder.toLowerCase()}\n${proposal}`;
}

/** SHA-256 as lowercase hex, via Web Crypto. */
export async function sha256Hex(text: string): Promise<string> {
  // TextEncoder is UTF-8 by specification, which is what `.encode("utf-8")`
  // does on the Python side. Any other encoding would agree on ASCII and
  // diverge on the first accented character in a proposal.
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The commitment for a proposal, byte-identical to the contract's. */
export function commitmentFor(salt: string, bidder: string, proposal: string): Promise<string> {
  return sha256Hex(sealPayload(salt, bidder, proposal));
}

/** A fresh 16-byte salt as 32 hex characters. */
export function newSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** What the contract's `is_hex_digest` accepts. */
export function isHexDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Python's whitespace, which is not JavaScript's.
 *
 * `normalise_criteria` splits with bare `str.split()`, so the set that counts
 * is every character where Python's `str.isspace()` is true. JavaScript's `\s`
 * is a different set, and differential testing against the contract found the
 * two disagree in both directions:
 *
 * - `\x1c`-`\x1f` and `\x85` are whitespace to Python and not to `\s`
 * - U+FEFF is whitespace to `\s` and not to Python
 *
 * That last one is the one that bites. A criterion pasted out of a file or a
 * word processor can carry a byte-order mark, and with `\s` the browser would
 * silently delete it while the contract kept it - two different digests for
 * one criteria set.
 */
const PY_SPACE = new RegExp(
  "[" +
    "\\t\\n\\v\\f\\r \\u001c-\\u001f\\u0085\\u00a0" +
    "\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000" +
  "]+",
);

/**
 * One criterion, normalised exactly as `normalise_criteria` does.
 *
 * The truncation counts CODE POINTS, matching Python's `[:160]` on a `str`.
 * `String.prototype.slice` counts UTF-16 code units, so a criterion using
 * astral characters would be cut in a different place - and, worse, could be
 * cut through the middle of a surrogate pair.
 */
export function normaliseCriterion(text: string, max = LIMITS.criterionTextMax): string {
  const collapsed = String(text).split(PY_SPACE).filter(Boolean).join(" ").trim().toLowerCase();
  return Array.from(collapsed).slice(0, max).join("");
}

/**
 * The identity of a criteria SET, order included.
 *
 * Must equal `criteria_digest` in the contract. The buyer's browser computes
 * this only to look up a verdict the contract stored under its own digest, so
 * a disagreement does not produce a wrong answer - it produces no answer at
 * all, and a publish flow that refuses to advance for reasons nothing on
 * screen can explain.
 */
export function criteriaDigest(texts: string[], max = LIMITS.criterionTextMax): Promise<string> {
  return sha256Hex(texts.map((t) => normaliseCriterion(t, max)).join("\n"));
}
