/**
 * The pure display helpers, tested.
 *
 *   node --test lib/format.test.ts
 *
 * Node strips the types itself, so this needs no build step and no test
 * framework. Every function in here decides what a number on a screen says
 * about money or about a deadline, and each has already been wrong once.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  countdown,
  formatDate,
  formatGen,
  humanError,
  maxTotal,
  nextDeadline,
  phaseOf,
  shortAddress,
  statusLabel,
  timeUntil,
  totalWeight,
} from "./format.ts";
import type { Round } from "./types.ts";

const T0 = Date.parse("2026-08-15T12:00:00Z");

function round(over: Partial<Round> = {}): Round {
  return {
    id: 0,
    buyer: "0x84ce300C589a3D657f544FB3c16eA68d0b46414B",
    title: "t",
    summary: "",
    criteria: [
      { i: 0, text: "a", weight: 3 },
      { i: 1, text: "b", weight: 1 },
    ],
    primary: 0,
    budget: "0",
    entry_deposit: "0",
    status: "open",
    published_at: "2026-08-15T10:00:00Z",
    commit_closes: "2026-08-15T13:00:00Z",
    reveal_closes: "2026-08-15T14:00:00Z",
    decide_closes: "2026-08-15T15:00:00Z",
    settled_at: "",
    awarded_to: "",
    awarded_total: 0,
    decline_reason: "",
    bids: 0,
    sealed: 0,
    scored: 0,
    max_bids: 8,
    criteria_hash: "",
    ...over,
  } as Round;
}

test("formatGen keeps every digit of a large budget", () => {
  // 40,000 GEN is 4e22 wei. Number(wei)/1e18 loses the low digits silently,
  // and this is the number on the award screen.
  assert.equal(formatGen("40000000000000000000000"), "40,000");
  assert.equal(formatGen(10n ** 18n), "1");
  assert.equal(formatGen("0"), "0");
  // Rounds rather than truncating, so 0.9 GEN is never displayed as "0".
  assert.equal(formatGen("900000000000000000"), "1");
  assert.equal(formatGen("400000000000000000"), "0");
  assert.equal(formatGen("1500000000000000000", 2), "1.5");
  assert.equal(formatGen("not a number"), "0");
});

test("shortAddress always keeps a visible elision marker", () => {
  const a = "0x84ce300C589a3D657f544FB3c16eA68d0b46414B";
  const out = shortAddress(a);
  // The regression this exists to prevent: a sweep once deleted the marker and
  // produced "0x84ce414B", which is valid hex and reads as a WHOLE address.
  assert.equal(out, "0x84ce-414B");
  assert.ok(out.includes("-"), "a truncated address must show that it was cut");
  assert.ok(!/^0x[0-9a-fA-F]+$/.test(out), "must not be mistakable for a full address");
  // `size` sets the tail length; the head is size + 2 so it carries the "0x".
  assert.equal(shortAddress(a, 3), "0x84c-14B");
  // Too short to truncate is returned whole rather than mangled.
  assert.equal(shortAddress("0x1234"), "0x1234");
  assert.equal(shortAddress(""), "-");
});

test("countdown shows seconds only where they change a decision", () => {
  const at = "2026-08-15T12:00:00Z";
  assert.equal(countdown(at, T0 - 45_000), "in 45s");
  assert.equal(countdown(at, T0 - 125_000), "in 2m 05s");
  assert.equal(countdown(at, T0 - 15 * 60_000), "in 15m");
  assert.equal(countdown(at, T0 - 3 * 3_600_000), "in 3h 00m");
  assert.equal(countdown(at, T0 - 26 * 3_600_000), "in 1d 2h");
  assert.equal(countdown(at, T0 + 30_000), "30s ago");
  assert.equal(countdown("nonsense", T0), "");
});

test("countdown and timeUntil agree about which side of the instant we are on", () => {
  const at = "2026-08-15T13:00:00Z";
  for (const offset of [-7200_000, -60_000, -1, 1, 60_000, 7200_000]) {
    const now = Date.parse(at) - offset;
    const ahead = offset > 0;
    assert.equal(countdown(at, now).startsWith("in "), ahead);
    assert.equal(timeUntil(at, now).startsWith("in "), ahead);
  }
});

test("phaseOf derives the window from the clock, never from stored status", () => {
  const r = round();
  assert.equal(phaseOf(r, Date.parse("2026-08-15T12:00:00Z")), "commit");
  assert.equal(phaseOf(r, Date.parse("2026-08-15T13:30:00Z")), "reveal");
  assert.equal(phaseOf(r, Date.parse("2026-08-15T14:30:00Z")), "decide");
  // The boundary instant belongs to the window that is closing, matching the
  // contract's own `<=` comparisons.
  assert.equal(phaseOf(r, Date.parse("2026-08-15T13:00:00Z")), "commit");
  assert.equal(phaseOf(r, Date.parse("2026-08-15T14:00:00Z")), "reveal");
  // A settled round is settled whatever the clock says.
  assert.equal(phaseOf(round({ status: "awarded" }), T0), "settled");
  assert.equal(phaseOf(round({ status: "declined" }), T0), "settled");
});

test("statusLabel and nextDeadline follow the phase", () => {
  const r = round();
  assert.equal(statusLabel(r, T0), "COMMIT OPEN");
  assert.equal(statusLabel(round({ status: "awarded" }), T0), "AWARDED");
  assert.equal(statusLabel(round({ status: "declined" }), T0), "DECLINED");
  assert.equal(nextDeadline(r, T0)?.label, "commit closes");
  assert.equal(nextDeadline(r, Date.parse("2026-08-15T13:30:00Z"))?.label, "reveal closes");
  assert.equal(nextDeadline(round({ status: "awarded" }), T0), null);
});

test("weights come from the criteria, not from the model", () => {
  assert.equal(totalWeight(round()), 4);
  assert.equal(maxTotal(round()), 20);
});

test("formatDate renders in UTC so two bidders read one deadline", () => {
  // Rendered in the reader's local zone, the same tender would show two
  // different closing times to two different bidders.
  assert.equal(formatDate("2026-08-15T13:04:00Z", true), "15 Aug, 13:04 UTC");
  assert.equal(formatDate("2025-01-02T00:00:00Z"), "2 Jan 2025");
  assert.equal(formatDate(""), "-");
  // An unparseable stamp is echoed rather than turned into a wrong date.
  assert.equal(formatDate("later"), "later");
});

test("humanError strips only the classification tag", () => {
  assert.equal(humanError("[EXPECTED] the commit window has closed"), "the commit window has closed");
  assert.equal(humanError("[LLM_ERROR] the model did not answer"), "the model did not answer");
  assert.equal(humanError("no tag here"), "no tag here");
  assert.equal(humanError(""), "");
});
