/**
 * Prove the bidder-side methods on a live network.
 *
 *   $env:CACHET_DEPLOYER_KEY = "0x..."
 *   node scripts/bidder.mjs --address=0x... --yes
 *
 * `amend`, `withdraw` and the `bidder` record are the half of this contract a
 * unit test cannot finish the argument about: they change what a slot means,
 * what a deadline permits, and what a deposit is owed to. Those are claims
 * about a live chain, so this makes them there.
 *
 * It runs one round with a short commit window and walks a bidder through
 * every state the new code introduces:
 *
 *   seal -> revise the seal -> pull out -> take the deposit back -> seal again
 *
 * and then reads the record the contract kept while it happened. Nothing here
 * needs a validator: every method it calls is deterministic, so the whole run
 * is minutes rather than the better part of an hour that `seed.mjs` takes.
 */
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  Abort,
  commitmentFor,
  countdown,
  criteriaDigest,
  die,
  flag,
  fundAccount,
  has,
  isoAt,
  makeClient,
  newSalt,
  pickChain,
  readWithRetry,
  refusalOf,
  sendWithRetry,
  statusOf,
  toWei,
  waitAccepted,
} from "./lib.mjs";

const chain = pickChain();
const ADDRESS = flag("address", process.env.NEXT_PUBLIC_CACHET_ADDRESS || "");
const TITLE = "Bidder-side proof";

const CRITERIA = [
  "relevant delivered work with references",
  "plan is specific and sequenced",
];
const WEIGHTS = [3, 1];

const results = [];
function record(label, ok, detail = "") {
  results.push({ label, ok });
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
}

const read = async (client, fn, args = []) =>
  JSON.parse(String(await readWithRetry(client, { address: ADDRESS, functionName: fn, args })));

async function write(client, fn, args, value = 0n, label = fn) {
  const hash = await sendWithRetry(client, { address: ADDRESS, functionName: fn, args, value });
  const receipt = await waitAccepted(client, hash, `    ${label}`);
  return { status: statusOf(receipt), refusal: refusalOf(receipt) };
}

const ok = (out) => String(out.status).toUpperCase() === "SUCCESS";

async function main() {
  const key = process.env.CACHET_DEPLOYER_KEY;
  if (!key) die('CACHET_DEPLOYER_KEY is not set.  PowerShell:  $env:CACHET_DEPLOYER_KEY = "0x..."');
  if (!/^0x[0-9a-fA-F]{40}$/.test(ADDRESS)) die("Pass --address=0x...");

  const commitSecs = Number(flag("commit", "300"));

  const { account: buyer, client: buyerClient } = makeClient(key, chain);
  const bidderKey = `0x${randomBytes(32).toString("hex")}`;
  const { account: bidder, client: bidderClient } = makeClient(bidderKey, chain);

  console.log("");
  console.log(`  contract   ${ADDRESS}`);
  console.log(`  buyer      ${buyer.address}`);
  console.log(`  bidder     ${bidder.address}`);
  console.log("");

  if (!has("yes")) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question("  Run it? Type yes to continue: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") die("Nothing was sent.");
  }

  console.log("  funding");
  await fundAccount(chain, buyer.address, "200000");
  await fundAccount(chain, bidder.address, "500");

  // The record before any of this, so every number below is a delta.
  const before = await read(buyerClient, "bidder", [bidder.address.toLowerCase()]);
  record("a fresh address has an empty record", before.made === 0 && before.entered === 0);

  console.log("\n  checking the criteria");
  await write(buyerClient, "check_criteria", [CRITERIA], 0n, "check_criteria");
  const gate = await read(buyerClient, "check", [criteriaDigest(CRITERIA)]);
  if (!gate.scorable) die(`the scorability gate refused: ${JSON.stringify(gate.reasons)}`);

  const commitAt = Date.now() + commitSecs * 1000;
  console.log("\n  publishing");
  const opened = await write(
    buyerClient,
    "open_round",
    [
      TITLE,
      "A round used to prove amend, withdraw and the bidder record.",
      CRITERIA,
      WEIGHTS,
      0,
      new Date(commitAt).toISOString().replace(/\.\d+Z$/, "Z"),
      isoAt(commitSecs * 1000 + 1_800_000),
      isoAt(commitSecs * 1000 + 5_400_000),
      "",
      2,
    ],
    toWei("5000"),
    "open_round",
  );
  if (!ok(opened)) die(`open_round failed: ${opened.refusal}`);

  // Identify OUR round rather than assuming it is the last one.
  const page = await read(buyerClient, "rounds_page", [0, 24]);
  const mine = page.rounds.find(
    (r) => r.title === TITLE && r.buyer.toLowerCase() === buyer.address.toLowerCase(),
  );
  if (!mine) die("open_round succeeded but the round could not be identified.");
  const id = mine.id;
  console.log(`\n  round id ${id}`);

  const terms = await read(buyerClient, "terms");
  const deposit = BigInt(terms.entry_deposit);

  // 1. seal
  const saltA = newSalt();
  const draftOne = "First draft. " + "We have delivered three comparable indexers. ".repeat(3);
  console.log("\n  sealing");
  const sealed = await write(
    bidderClient,
    "commit",
    [id, commitmentFor(saltA, bidder.address, draftOne)],
    deposit,
    "commit",
  );
  record("the bid is sealed", ok(sealed), sealed.refusal);

  let bids = await read(buyerClient, "bids", [id]);
  record("it is stored as sealed", bids.bids[0]?.status === "sealed");
  record("with no amendments yet", bids.bids[0]?.amendments === 0);

  // 2. revise the seal
  const draftTwo = "Second draft. " + "Dates: 1 September to 24 October, in two-week blocks. ".repeat(3);
  console.log("\n  revising the seal");
  const amended = await write(
    bidderClient,
    "amend",
    [id, 0, commitmentFor(saltA, bidder.address, draftTwo)],
    0n,
    "amend",
  );
  record("the seal can be replaced while the window is open", ok(amended), amended.refusal);

  bids = await read(buyerClient, "bids", [id]);
  record(
    "the stored commitment is the new one",
    bids.bids[0]?.commitment === commitmentFor(saltA, bidder.address, draftTwo),
  );
  record("the revision is counted", bids.bids[0]?.amendments === 1);
  record("and dated", Boolean(bids.bids[0]?.amended_at));
  record("no second row was created", bids.bids.length === 1);

  const sameAgain = await write(
    bidderClient,
    "amend",
    [id, 0, commitmentFor(saltA, bidder.address, draftTwo)],
    0n,
    "amend (no-op)",
  );
  record("re-submitting the same digest is refused", !ok(sameAgain), sameAgain.refusal);

  // 3. pull out
  console.log("\n  withdrawing");
  const pulled = await write(bidderClient, "withdraw", [id, 0], 0n, "withdraw");
  record("the bid can be withdrawn while the window is open", ok(pulled), pulled.refusal);

  bids = await read(buyerClient, "bids", [id]);
  record("it reads as withdrawn", bids.bids[0]?.status === "withdrawn");
  record("the deposit is owed back", BigInt(bids.bids[0]?.owed ?? "0") === deposit);

  let round = await read(buyerClient, "round", [id]);
  record("the round no longer counts it as a bid", round.bids === 0, `bids ${round.bids}`);
  record("but the row is still there", round.rows === 1);
  record("and it is reported as withdrawn", round.withdrawn === 1);

  // 4. take the deposit back, without waiting for the round to settle
  console.log("\n  claiming the deposit back");
  const claimed = await write(bidderClient, "claim", [id, 0], 0n, "claim");
  record("a withdrawn deposit is claimable before settlement", ok(claimed), claimed.refusal);
  bids = await read(buyerClient, "bids", [id]);
  record("nothing is owed twice", BigInt(bids.bids[0]?.owed ?? "0") === 0n);

  // 5. seal again
  console.log("\n  sealing a second time");
  const saltB = newSalt();
  const finalText = "Final. " + "Three named references, fixed dates, maintenance included. ".repeat(3);
  const again = await write(
    bidderClient,
    "commit",
    [id, commitmentFor(saltB, bidder.address, finalText)],
    deposit,
    "commit",
  );
  record("a withdrawn bidder may re-enter", ok(again), again.refusal);

  bids = await read(buyerClient, "bids", [id]);
  record("the new bid is live", bids.bids[1]?.status === "sealed");
  round = await read(buyerClient, "round", [id]);
  record("the round counts one bid again", round.bids === 1);

  // 5b. clarifications, asked and answered in public
  console.log("\n  asking a question");
  const asked = await write(
    bidderClient,
    "ask",
    [id, "Does maintenance after handover include out-of-hours cover?"],
    0n,
    "ask",
  );
  record("anyone may ask while the window is open", ok(asked), asked.refusal);

  let qs = await read(buyerClient, "questions", [id]);
  record("the question is public", qs.questions.length === 1);
  record("with no answer yet", qs.questions[0]?.answer === "");
  let roundQ = await read(buyerClient, "round", [id]);
  record("the round counts it unanswered", roundQ.questions_unanswered === 1);

  const notBuyer = await write(
    bidderClient,
    "answer",
    [id, 0, "I will answer my own question, thanks"],
    0n,
    "answer (not the buyer)",
  );
  record("only the buyer may answer", !ok(notBuyer), notBuyer.refusal);

  console.log("\n  answering it");
  const answered = await write(
    buyerClient,
    "answer",
    [id, 0, "Yes. Out-of-hours cover is in scope for the first ninety days."],
    0n,
    "answer",
  );
  record("the buyer answers in public", ok(answered), answered.refusal);

  qs = await read(buyerClient, "questions", [id]);
  record("the answer is published", qs.questions[0]?.answer.startsWith("Yes."));
  record("and dated", Boolean(qs.questions[0]?.answered_at));
  roundQ = await read(buyerClient, "round", [id]);
  record("nothing is left unanswered", roundQ.questions_unanswered === 0);

  const revised = await write(
    buyerClient,
    "answer",
    [id, 0, "Actually, no."],
    0n,
    "answer (again)",
  );
  record("an answer cannot be revised", !ok(revised), revised.refusal);

  // 6. the record
  const rec = await read(buyerClient, "bidder", [bidder.address.toLowerCase()]);
  console.log("\n  the record this bidder now has:");
  console.log(`    entered ${rec.entered}   made ${rec.made}   withdrawn ${rec.withdrawn}   sealed ${rec.sealed}`);
  record("one round entered", rec.entered === 1, `entered ${rec.entered}`);
  record("two commitments made", rec.made === 2, `made ${rec.made}`);
  record("one withdrawal on the record", rec.withdrawn === 1);
  record("nothing expired", rec.expired === 0);
  record("one still sealed", rec.sealed === 1);
  record(
    "the identity holds",
    rec.made === rec.revealed + rec.expired + rec.withdrawn + rec.sealed,
  );
  record("the round appears on their record", rec.rounds.some((r) => r.id === id));
  const row = rec.rounds.find((r) => r.id === id)?.mine;
  record("with their own row picked out", row?.i === 1 && row?.status === "sealed");

  // 7. the window closes, and both actions stop being available
  await countdown("the commit window to close", commitAt);
  const lateAmend = await write(
    bidderClient,
    "amend",
    [id, 1, commitmentFor(saltB, bidder.address, "too late")],
    0n,
    "amend (late)",
  );
  record("amending after the window is refused", !ok(lateAmend), lateAmend.refusal);
  const lateWithdraw = await write(bidderClient, "withdraw", [id, 1], 0n, "withdraw (late)");
  record("withdrawing after the window is refused", !ok(lateWithdraw), lateWithdraw.refusal);
  const lateAsk = await write(
    bidderClient,
    "ask",
    [id, "Can I still ask something now the window has shut?"],
    0n,
    "ask (late)",
  );
  record("questions close with the commit window", !ok(lateAsk), lateAsk.refusal);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length} of ${results.length} checks passed\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  if (error instanceof Abort) console.error(`\n  ${error.message}\n`);
  else console.error(`\n  ${error?.shortMessage ?? error?.message ?? error}\n`);
  process.exitCode = 1;
});
