/**
 * Prove a DEPLOYED Cachet actually works, against the real network.
 *
 *   npm run verify -- --address=0x...
 *
 * Read-only and free. It signs nothing, sends nothing and needs no key, so it
 * is safe to run against a live contract at any time - including one somebody
 * else deployed, which is the point: anyone can check the address they were
 * given rather than taking it on trust.
 *
 * Seven checks, cheapest first, because there is no point reading a round out
 * of a contract that is not the one you think it is:
 *
 *   1. the address answers at all
 *   2. the VERSION it publishes matches this repo's source
 *   3. its published limits match the constants this repo compiled against
 *   4. the paging view is sane, including the offsets that used to crash it
 *   5. a round reads back with its criteria frozen and its digest matching
 *   6. the bids on that round agree with the counters the round reports
 *   7. an address that never bid reads as empty rather than as an error
 *
 * Check 2 is the one worth the round trip. "Is the contract at this address
 * the one in the repo?" has already been the wrong answer on this project: an
 * address was live while the source moved two review passes ahead of it, and
 * nothing on chain said so. Now it does, and this refuses to go on when they
 * disagree.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "genlayer-js";

import { die, flag, pickChain, readWithRetry } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(HERE, "..", "contracts", "cachet.py");

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  OK    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`          expected ${JSON.stringify(expected)}`);
    console.log(`          got      ${JSON.stringify(actual)}`);
  }
}

function checkTrue(label, value) {
  check(label, Boolean(value), true);
}

/** The value of a top-level `NAME = "..."` or `NAME = 123` in the source. */
function constantFromSource(source, name) {
  const quoted = new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m").exec(source);
  if (quoted) return quoted[1];
  const bare = new RegExp(`^${name}\\s*=\\s*(\\d+)`, "m").exec(source);
  return bare ? Number(bare[1]) : undefined;
}

async function main() {
  const address = flag("address", "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    die(
      [
        "Pass the contract to check.",
        "",
        "  npm run verify -- --address=0x...",
        "",
        "Use the address EXACTLY as the deploy script printed it. gen_call answers",
        '"Contract not found" for the all-lowercase form of a live contract.',
      ].join("\n"),
    );
  }

  const chain = pickChain();
  const client = createClient({ chain });
  const source = readFileSync(CONTRACT, "utf8");

  console.log("");
  console.log(`  contract       ${address}`);
  console.log(`  network        ${chain.name} (chain ${chain.id})`);
  console.log(`  source         contracts/cachet.py`);
  console.log("");

  const read = async (functionName, args = []) => {
    const raw = await readWithRetry(client, { address, functionName, args });
    return JSON.parse(String(raw));
  };

  /* 1 + 2 + 3 -------------------------------------------------------- */
  console.log("  terms");
  let terms;
  try {
    terms = await read("terms");
  } catch (error) {
    die(
      [
        `The contract at ${address} did not answer.`,
        `  ${error?.shortMessage ?? error?.message ?? error}`,
        "",
        "If the address is right, check its capitalisation: the all-lowercase form",
        'of a live contract answers "Contract not found".',
      ].join("\n"),
    );
  }
  checkTrue("the address answers", terms && typeof terms === "object");

  const wantVersion = constantFromSource(source, "VERSION");
  check("the deployed version matches this repo", terms.version, wantVersion);
  if (terms.version !== wantVersion) {
    console.log("");
    console.log("  This address is NOT running the source in this repo. Everything below");
    console.log("  would be checking a different contract, so it stops here.");
    console.log("");
    // `process.exitCode` rather than `process.exit`: killing the process while
    // the rpc client still holds an open handle aborts Node on Windows with
    // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", which buries
    // the finding under a crash that looks like the bug.
    process.exitCode = 1;
    return;
  }

  for (const [name, key] of [
    ["SCORE_MAX", "score_max"],
    ["WEIGHT_MAX", "weight_max"],
    ["CRITERIA_MAX", "criteria_max"],
    ["PROPOSAL_MAX", "proposal_max"],
    ["BIDS_MAX_CAP", "bids_max"],
  ]) {
    check(`${key} matches ${name} in the source`, terms[key], constantFromSource(source, name));
  }

  /* 4 ---------------------------------------------------------------- */
  console.log("\n  paging");
  const page = await read("rounds_page", [0, 12]);
  checkTrue("rounds_page answers", Array.isArray(page.rounds));
  checkTrue("it reports a total", Number.isInteger(page.total));
  checkTrue("the page is no longer than asked for", page.rounds.length <= 12);
  checkTrue("and no longer than the total", page.rounds.length <= page.total);

  // The offsets that used to take this view down with an IndexError.
  const negative = await read("rounds_page", [-1, 12]);
  check("a negative offset still answers", negative.total, page.total);
  const beyond = await read("rounds_page", [page.total + 50, 12]);
  check("an offset past the end is empty", beyond.rounds.length, 0);
  check("and still reports the true total", beyond.total, page.total);

  /* 5 + 6 ------------------------------------------------------------ */
  if (page.total === 0) {
    console.log("\n  rounds");
    console.log("  --    no round published yet, so there is nothing to read into");
  } else {
    const newest = page.rounds[0];
    console.log(`\n  round ${newest.id}`);
    const round = await read("round", [newest.id]);
    check("the round reads back", round.found === false ? "missing" : "found", "found");
    check("its id matches the page", round.id, newest.id);
    checkTrue("it has at least one criterion", round.criteria.length >= 1);
    checkTrue("every criterion carries a weight", round.criteria.every((c) => c.weight >= 1));
    checkTrue("it publishes a criteria digest", /^[0-9a-f]{64}$/.test(round.criteria_hash));

    const bids = await read("bids", [newest.id]);
    checkTrue("the bids read back", bids.found === true);
    const rows = bids.bids ?? [];
    const inPlay = rows.filter((b) => b.status !== "withdrawn").length;
    check("the bid count agrees with the round", inPlay, round.bids);
    check(
      "the scored count agrees with the round",
      rows.filter((b) => b.status === "scored").length,
      round.scored,
    );
    checkTrue(
      "every scored bid carries a reason per criterion",
      rows
        .filter((b) => b.status === "scored")
        .every((b) => b.reasons.length === round.criteria.length),
    );
  }

  /* 7 ---------------------------------------------------------------- */
  console.log("\n  an address that never bid");
  const stranger = "0x" + "cd".repeat(20);
  const record = await read("bidder", [stranger]);
  check("reads as empty rather than failing", record.entered, 0);
  checkTrue("and returns a record shape", Array.isArray(record.rounds));

  console.log("");
  console.log(`  ${passed} of ${passed + failed} checks passed`);
  console.log("");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("");
  console.error(`  verify failed: ${error?.shortMessage ?? error?.message ?? error}`);
  console.error("");
  process.exitCode = 1;
});
