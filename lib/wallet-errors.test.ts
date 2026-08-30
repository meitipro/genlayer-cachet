import { test } from "node:test";
import assert from "node:assert/strict";

import { readableError, WalletAccountChanged } from "./wallet-errors.ts";

/**
 * The case that shipped.
 *
 * A publish attempt through Rabby produced this, and the reader saw the RPC's
 * generic sentence twice followed by the only informative clause cut off after
 * "current ad". Every assertion below is about that one screenful of text.
 */
const RABBY_MISMATCH = {
  code: -32602,
  details: "from should be same as current address",
  shortMessage:
    "Invalid parameters were provided to the RPC method. Double check you have provided the correct parameters.",
  message:
    "Invalid parameters were provided to the RPC method. Double check you have provided the correct parameters. Details: from should be same as current address",
};

test("the Rabby account mismatch becomes an instruction, not an RPC dump", () => {
  const out = readableError(RABBY_MISMATCH);
  assert.match(out, /different account/i);
  assert.match(out, /switch back/i);
  // The reader must know nothing was spent.
  assert.match(out, /nothing was sent/i);
  // And must not be handed the raw RPC text.
  assert.doesNotMatch(out, /Invalid parameters were provided/);
  assert.doesNotMatch(out, /-32602/);
});

test("repeated viem parts are said once", () => {
  const out = readableError({
    details: "boom",
    shortMessage: "boom",
    message: "boom",
  });
  assert.equal(out, "boom");
});

test("a part that merely contains another is not stacked on top of it", () => {
  const out = readableError({
    shortMessage: "The contract refused.",
    message: "The contract refused. Details: not the buyer",
  });
  // One of the two, never both - the longer one carries the shorter.
  assert.equal(out.split("The contract refused.").length - 1, 1);
});

test("a long message is cut on a word boundary, never mid-word", () => {
  const long = "alpha bravo charlie delta echo foxtrot golf hotel ".repeat(20);
  const out = readableError({ message: long });
  assert.ok(out.length <= 300, `got ${out.length}`);
  // The last token must be a whole word from the source.
  const last = out.trim().split(" ").pop() as string;
  assert.ok(
    ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"].includes(last),
    `ended mid-word on "${last}"`,
  );
});

test("a short message is returned whole", () => {
  assert.equal(readableError({ message: "Round is closed." }), "Round is closed.");
});

test("a rejection in the wallet is not reported as a failure", () => {
  assert.match(readableError({ code: 4001, message: "User rejected" }), /you rejected/i);
});

test("rate limiting says to wait and that nothing was sent", () => {
  const out = readableError({ message: "429 rate limit exceeded" });
  assert.match(out, /nothing was sent/i);
});

test("WalletAccountChanged names both addresses so the reader can match one", () => {
  const e = new WalletAccountChanged(
    "0x84ce414B9dF9E3D2E0a1B7c9f0000000000000AA",
    "0x1111111111111111111111111111111111111111",
  );
  const out = readableError(e);
  assert.match(out, /0x84ce/i);
  assert.match(out, /0x1111/);
  assert.match(out, /nothing was sent/i);
  // The house separator, so a truncated address can only read as truncated.
  // Written as a code point rather than the character itself: a repo-wide
  // sweep for forbidden connectors would otherwise flag this assertion, which
  // exists precisely to forbid it.
  assert.doesNotMatch(out, new RegExp(String.fromCharCode(0x2026)));
});

test("an error object with nothing useful still returns something", () => {
  assert.ok(readableError(new Error("plain")).length > 0);
  assert.ok(readableError("just a string").length > 0);
});
