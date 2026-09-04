/**
 * Run real tenders through a deployed Cachet contract.
 *
 *   $env:CACHET_DEPLOYER_KEY = "0x..."
 *   npm run seed -- --address=0x... --yes
 *
 * This is not a fixture loader. Every round below is published, bid into,
 * revealed, scored by the network and settled, with real windows on the real
 * clock - which is why it takes as long as it does. The waits are the point: a
 * reveal submitted before the commit window closes has to be refused, and the
 * only honest way to show that is to try it and be refused.
 *
 * RESUMABLE. Bidder keys, salts and completed steps are written to
 * scripts/.seed-state.json as they happen. If the run dies - rate limits, a
 * dropped connection, a closed terminal - running it again continues from the
 * last completed step with the same accounts. Without that, an interrupted run
 * strands five sealed commitments nobody holds the salt for. Pass --fresh to
 * start over against a newly deployed contract.
 *
 * What it proves, in order:
 *
 *   1. The scorability gate refuses criteria that cannot be scored from text,
 *      and names which ones.
 *   2. open_round refuses criteria that never passed that gate.
 *   3. A reveal during the commit window is refused.
 *   4. A reveal whose text does not match the sealed digest is refused, and
 *      nothing is stored - the bidder can still reveal correctly afterwards.
 *   5. A bidder who never reveals expires and forfeits the deposit.
 *   6. Every revealed bid is scored per criterion, and totals are summed from
 *      the agreed scores rather than proposed by a model.
 *   7. An already-scored bid cannot be scored twice.
 *   8. An appeal that points at real wording is re-scored, and the bond comes
 *      back iff the total moved.
 *   9. An open appeal holds the award; one unscored bid blocks it too.
 *  10. Award pays the highest weighted total, and a bidder can pull a deposit.
 *
 * Flags:
 *   --address=0x...   the deployed contract (required)
 *   --commit=900      seconds until the commit window closes
 *   --reveal=2700     seconds until the reveal window closes
 *   --decide=14400    seconds until the buyer's decision window closes
 *   --fresh           discard saved state and start over
 *   --skip-docket     stop after the flagship round
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
  fromWei,
  fundAccount,
  has,
  isoAt,
  makeClient,
  newSalt,
  pickChain,
  readWithRetry,
  refusalOf,
  sendWithRetry,
  sleep,
  statusOf,
  toWei,
  waitAccepted,
  waitFinal,
} from "./lib.mjs";
import { openState } from "./state.mjs";
import {
  DOCS_CRITERIA,
  DOCS_WEIGHTS,
  INFRA_CRITERIA,
  INFRA_WEIGHTS,
  KESTREL_APPEAL,
  PROPOSALS,
  REVIEW_CRITERIA,
  REVIEW_WEIGHTS,
  UNSCORABLE_CRITERIA,
} from "./rounds.mjs";

const chain = pickChain();
const ADDRESS = flag("address", process.env.NEXT_PUBLIC_CACHET_ADDRESS || "");

const results = [];
function record(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
}

let state;

/** Run a named step once per contract, ever. */
/**
 * Run a step once, and record it as done only if it actually worked.
 *
 * `fn` may return false to mean "this did not complete". That distinction was
 * missing and it cost a whole run: the scorability gate is a consensus call,
 * its transaction can finalize while the nondeterministic block never agrees,
 * and `write` returning without throwing was taken as success. The step went
 * into `done`, nothing was stored on chain, and every resumed run then SKIPPED
 * the step and died reading a record that was never written. A resumable
 * script that records failures as progress is worse than one that cannot
 * resume at all.
 */
async function step(name, fn) {
  if (state.isDone(name)) {
    console.log(`  ..    ${name}  (already done)`);
    return;
  }
  const result = await fn();
  if (result === false) return;
  state.markDone(name);
}

/**
 * Run the scorability gate until the network actually returns a verdict.
 *
 * A consensus call has three outcomes, not two: agreed-and-scorable,
 * agreed-and-refused, and NO AGREEMENT. Only the third is retried here, and it
 * is retried because nothing was written - the network did not judge, so there
 * is no judgement to re-roll.
 *
 * This is not "ask again until it says yes", and the contract makes sure it
 * cannot become that: once a verdict is stored, `check_criteria` refuses a
 * repeat outright with ERR_ALREADY_CHECKED, in EITHER direction. So a refusal
 * ends the loop on the first pass, exactly like a pass does. The only thing
 * this survives is the network failing to answer.
 */
async function gateUntilJudged(client, criteria, label, attempts = 4) {
  const digest = criteriaDigest(criteria);
  for (let i = 1; i <= attempts; i++) {
    const existing = await read(client, "check", [digest]);
    if (existing.found === true) return existing;

    const out = await write(client, "check_criteria", [criteria], 0n, label);
    if (ok(out)) {
      const stored = await read(client, "check", [digest]);
      if (stored.found === true) return stored;
    }

    // Either the call errored or it succeeded without leaving a record, and
    // both mean the same thing: the validators did not agree on the booleans.
    // The leader rotates between attempts, so a different model set tries next.
    if (i < attempts) {
      console.log(
        `        no consensus on attempt ${i}/${attempts}${out.refusal ? ` (${out.refusal})` : ""} - the validators did not agree, retrying`,
      );
      await sleep(6000);
    }
  }
  return { found: false };
}

async function read(client, functionName, args = []) {
  const raw = await readWithRetry(client, { address: ADDRESS, functionName, args });
  return JSON.parse(String(raw));
}

/**
 * Send a write and wait.
 *
 * ACCEPTED by default, not FINALIZED. Records and status changes act on
 * acceptance in this contract - deliberately, so a bidder can read a scorecard
 * during the appeal window - and views read the latest non-final state, so
 * acceptance is the moment a change becomes visible. Waiting for finality on
 * all forty-odd transactions here would triple the runtime and prove nothing
 * extra.
 *
 * Pass final:true where it genuinely matters: anything that moves value waits
 * for finality, so award and claim are only real once the emitted transfer can
 * actually fire.
 */
async function write(client, functionName, args, value = 0n, label = functionName, final = false) {
  const hash = await sendWithRetry(client, { address: ADDRESS, functionName, args, value });
  const wait = final ? waitFinal : waitAccepted;
  const receipt = await wait(client, hash, `    ${label}`);
  return { hash, receipt, status: statusOf(receipt), refusal: refusalOf(receipt) };
}

const ok = (out) => String(out.status).toUpperCase() === "SUCCESS";

/**
 * Submit a call that is EXPECTED to be refused, and report the refusal text.
 *
 * A clean refusal leaves stderr empty and finalizes normally - "no error
 * output" and "the transaction finalized" are both exactly what success looks
 * like too. The only field that answers the question is the leader receipt's
 * execution_result, and the sentence lives beside it in result.payload.
 */
async function expectRefusal(client, functionName, args, value, label, fragment) {
  let out;
  try {
    out = await write(client, functionName, args, value, label, true);
  } catch (error) {
    // A pre-consensus rejection is still a refusal; it just never got a receipt.
    const text = String(error?.message || error);
    record(label, text.toLowerCase().includes(fragment.toLowerCase()), text.slice(0, 140));
    return;
  }
  const message = out.refusal || "(no message in the receipt)";
  const matched = !ok(out) && message.toLowerCase().includes(fragment.toLowerCase());
  record(label, matched, matched ? `"${message}"` : `status ${out.status}, message "${message}"`);
}

const NAMES = ["meridian", "kestrel", "ninebark", "orrery", "sable"];

async function main() {
  const key = process.env.CACHET_DEPLOYER_KEY;
  if (!key) die('CACHET_DEPLOYER_KEY is not set.  PowerShell:  $env:CACHET_DEPLOYER_KEY = "0x..."');
  if (!/^0x[0-9a-fA-F]{40}$/.test(ADDRESS)) {
    die("Pass the deployed contract:  npm run seed -- --address=0x...");
  }

  // The commit window has to outlast five sealed commitments plus the two
  // refusals proved inside it, on a network that rate limits at 30 requests a
  // minute. A window that closes mid-run does not fail loudly - it silently
  // turns the remaining commits into "the commit window has closed", which
  // reads like a contract bug and is a stopwatch problem.
  const commitSecs = Number(flag("commit", "900"));
  const revealSecs = Number(flag("reveal", "2700"));
  const decideSecs = Number(flag("decide", "14400"));

  if (!(commitSecs < revealSecs && revealSecs < decideSecs)) {
    die("--commit must be less than --reveal, which must be less than --decide.");
  }

  state = openState(ADDRESS, has("fresh"));

  const { account: buyer, client: buyerClient } = makeClient(key, chain);

  const bidders = {};
  for (const name of NAMES) {
    const bidderKey = state.remember("keys", name, () => `0x${randomBytes(32).toString("hex")}`);
    bidders[name] = makeClient(bidderKey, chain);
  }

  console.log("");
  console.log(`  network     ${chain.name} (chain ${chain.id})`);
  console.log(`  contract    ${ADDRESS}`);
  console.log(`  buyer       ${buyer.address}`);
  for (const name of NAMES) {
    console.log(`  ${name.padEnd(11)} ${bidders[name].account.address}`);
  }
  console.log("");
  console.log(`  state       ${state.file}`);
  console.log(`  completed   ${state.data.done.length} step(s) so far`);
  console.log("");

  if (!has("yes")) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question("  Run it? Type yes to continue: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") die("Nothing was sent.");
  }

  await step("fund", async () => {
    console.log("\n  funding accounts");
    await fundAccount(chain, buyer.address, "2000000");
    for (const name of NAMES) await fundAccount(chain, bidders[name].account.address, "1000");
    console.log("    funded");
  });

  const terms = await read(buyerClient, "terms");
  const deposit = BigInt(terms.entry_deposit);
  const bond = BigInt(terms.appeal_bond);
  console.log(`\n  entry deposit ${fromWei(deposit)} GEN, appeal bond ${fromWei(bond)} GEN\n`);

  // ------------------------------------------------------------------
  // 1. The scorability gate
  // ------------------------------------------------------------------

  console.log("  --- the scorability gate ---\n");

  await step("gate:check-unscorable", async () => {
    console.log("  checking criteria that cannot be scored from a proposal");
    await write(buyerClient, "check_criteria", [UNSCORABLE_CRITERIA], 0n, "check (unscorable)");
  });

  const bad = await read(buyerClient, "check", [criteriaDigest(UNSCORABLE_CRITERIA)]);
  record(
    "the network refuses criteria it cannot score",
    bad.found === true && bad.scorable === false && (bad.flagged || []).length > 0,
    `flagged ${JSON.stringify(bad.flagged)} of ${UNSCORABLE_CRITERIA.length}`,
  );
  if (bad.reasons?.length) console.log(`        reasons: ${bad.reasons.join(" / ")}`);

  await step("gate:publish-refused", async () => {
    console.log("\n  publishing with criteria that never passed the gate");
    await expectRefusal(
      buyerClient,
      "open_round",
      [
        "A tender nobody could score",
        "Should never exist.",
        UNSCORABLE_CRITERIA,
        [1, 1, 1],
        0,
        isoAt(commitSecs * 1000),
        isoAt(revealSecs * 1000),
        isoAt(decideSecs * 1000),
        "",
        8,
      ],
      toWei("100"),
      "publishing unscorable criteria is refused",
      "scorability check",
    );
  });

  // ------------------------------------------------------------------
  // 2. The flagship round
  // ------------------------------------------------------------------

  console.log("\n  --- the flagship round ---\n");

  console.log("  checking the infrastructure criteria");
  const infraCheck = await gateUntilJudged(
    buyerClient,
    INFRA_CRITERIA,
    "check (infra)",
  );
  record(
    "criteria that can be scored from text pass the gate",
    infraCheck.found === true && infraCheck.scorable === true,
    `${INFRA_CRITERIA.length} of ${INFRA_CRITERIA.length} scorable`,
  );
  if (!infraCheck.scorable) {
    die(
      "The gate refused the brief's own criteria, so the round cannot be published.\n" +
        `  flagged: ${JSON.stringify(infraCheck.flagged)} - ${JSON.stringify(infraCheck.reasons)}`,
    );
  }

  // Deadlines are stored the first time through, so a resumed run waits on the
  // windows the round was actually published with rather than fresh ones.
  const commitAt = state.remember("rounds", "commitAt", () => Date.now() + commitSecs * 1000);
  const revealAt = state.remember("rounds", "revealAt", () => Date.now() + revealSecs * 1000);

  /**
   * Publish once, ever.
   *
   * `step` alone is not enough here. If the wait times out AFTER the
   * transaction was submitted, the step never gets marked done, the run is
   * restarted, and a second tender escrows a second 40,000 GEN. So the
   * expensive, irreversible call also checks the chain for its own effect
   * before repeating it. Rounds are identified by buyer plus title, which is
   * exactly what makes a duplicate a duplicate.
   */
  async function findExistingRound(title) {
    const page = await read(buyerClient, "rounds_page", [0, 24]);
    const hit = page.rounds.find(
      (r) =>
        r.title === title &&
        r.buyer.toLowerCase() === buyer.address.toLowerCase() &&
        // Only a round that can still be bid into counts as "already
        // published". One whose commit window has closed is not a duplicate to
        // avoid, it is a dead round - reusing it would fail every commit with
        // "the commit window has closed", which reads like a contract bug.
        Date.now() < Date.parse(r.commit_closes),
    );
    return hit ? hit.id : null;
  }

  const FLAGSHIP_TITLE = "Indexer replacement for the settlement archive";

  await step("infra:publish", async () => {
    const already = await findExistingRound(FLAGSHIP_TITLE);
    if (already !== null) {
      console.log(`\n  round ${already} is already published - not escrowing a second budget`);
      record("a tender is published and the budget escrowed", true, `round ${already}, already on chain`);
      state.remember("rounds", "flagship", () => already);
      return;
    }
    console.log("\n  publishing and escrowing 40,000 GEN");
    const opened = await write(
      buyerClient,
      "open_round",
      [
        FLAGSHIP_TITLE,
        "Replace the block indexer behind the settlement archive, including the migration off the current schema and a documented handover.",
        INFRA_CRITERIA,
        INFRA_WEIGHTS,
        0,
        new Date(commitAt).toISOString().replace(/\.\d+Z$/, "Z"),
        new Date(revealAt).toISOString().replace(/\.\d+Z$/, "Z"),
        isoAt(decideSecs * 1000),
        "",
        8,
      ],
      toWei("40000"),
      "open_round",
    );
    record("a tender is published and the budget escrowed", ok(opened), opened.refusal);
    if (!ok(opened)) die(`open_round failed: ${opened.refusal}`);
    // Find OUR round rather than assuming it is the last one. `stats.rounds-1`
    // is only correct if nothing else published in between, which is an
    // assumption about the whole network, not about this script.
    const mine = await findExistingRound(FLAGSHIP_TITLE);
    if (mine === null) die("open_round succeeded but the round could not be found to identify it.");
    state.remember("rounds", "flagship", () => mine);
  });

  const roundId = state.data.rounds.flagship;
  console.log(`\n  round id ${roundId}`);

  const entries = NAMES.map((name) => [name, PROPOSALS[name]]);
  const indexOf = (name) => NAMES.indexOf(name);

  // -- sealed commitments -------------------------------------------------

  /**
   * Has this bidder already got a bid on the round, in a state at or past
   * `atLeast`?
   *
   * `step` marks a step done only AFTER its wait returns, so a run killed
   * mid-wait leaves a transaction that landed and a step that looks unstarted.
   * Resuming then re-commits (a second deposit, refused as a duplicate) or
   * re-reveals (refused as "already handled") and the script dies on a
   * transaction that actually worked. Reading the chain first is the only
   * honest way to know.
   */
  const ORDER = ["sealed", "revealed", "scored"];
  async function bidOf(name) {
    const data = await read(buyerClient, "bids", [roundId]);
    const addr = bidders[name].account.address.toLowerCase();
    return data.bids.find((b) => b.bidder.toLowerCase() === addr) ?? null;
  }
  async function alreadyAt(name, atLeast) {
    const b = await bidOf(name);
    if (!b) return false;
    if (b.status === "expired") return true;
    return ORDER.indexOf(b.status) >= ORDER.indexOf(atLeast);
  }

  console.log("\n  taking sealed commitments");
  for (const name of NAMES) {
    const salt = state.remember("salts", name, () => newSalt());
    await step(`commit:${name}`, async () => {
      if (await alreadyAt(name, "sealed")) {
        console.log(`    commit ${name}: already on chain`);
        return;
      }
      const { account, client } = bidders[name];
      const digest = commitmentFor(salt, account.address, PROPOSALS[name]);
      const out = await write(client, "commit", [roundId, digest], deposit, `commit ${name}`);
      if (!ok(out)) die(`${name} could not commit: ${out.refusal || out.status}`);
    });
  }

  /**
   * Assertions about a MOMENT in the round's life, not about the round.
   *
   * "Five commitments are sealed" and "no proposal text is readable" are both
   * true only while the commit window is open. Re-running them on a resumed
   * run, after four bids have revealed, reports two failures for a round that
   * is working exactly as designed. Anything time-bound goes inside a step so
   * it is asserted once, when it means something.
   */
  await step("assert:sealed", async () => {
    const afterCommit = await read(buyerClient, "round", [roundId]);
    record(
      "five sealed commitments are on record",
      afterCommit.bids === 5 && afterCommit.sealed === 5,
      `${afterCommit.bids} bids, ${afterCommit.sealed} sealed`,
    );
    record(
      "no proposal text is readable while the window is open",
      (await read(buyerClient, "bids", [roundId])).bids.every((b) => b.proposal === ""),
    );
  });

  // -- a reveal before the window opens -----------------------------------

  await step("reveal:too-early", async () => {
    console.log("\n  revealing during the commit window");
    await expectRefusal(
      bidders.meridian.client,
      "reveal",
      [roundId, indexOf("meridian"), state.data.salts.meridian, PROPOSALS.meridian],
      0n,
      "a reveal before the commit window closes is refused",
      "reveal window has not opened",
    );
  });

  await countdown("the commit window to close", commitAt);

  // -- a reveal that does not match ---------------------------------------

  await step("reveal:mismatch", async () => {
    console.log("\n  revealing an edited proposal");
    await expectRefusal(
      bidders.meridian.client,
      "reveal",
      [
        roundId,
        indexOf("meridian"),
        state.data.salts.meridian,
        `${PROPOSALS.meridian}\n\nPS: and we can start a week earlier.`,
      ],
      0n,
      "an edited proposal does not match the seal",
      "does not match",
    );
    const stillSealed = await read(buyerClient, "bid", [roundId, indexOf("meridian")]);
    record(
      "and the refused reveal stored nothing",
      stillSealed.bid.status === "sealed" && stillSealed.bid.proposal === "",
      `status ${stillSealed.bid.status}`,
    );
  });

  // -- honest reveals; orrery never reveals -------------------------------

  console.log("\n  revealing");
  const revealed = ["meridian", "kestrel", "ninebark", "sable"];
  for (const name of revealed) {
    await step(`reveal:${name}`, async () => {
      if (await alreadyAt(name, "revealed")) {
        console.log(`    reveal ${name}: already on chain`);
        return;
      }
      const out = await write(
        bidders[name].client,
        "reveal",
        [roundId, indexOf(name), state.data.salts[name], PROPOSALS[name]],
        0n,
        `reveal ${name}`,
      );
      if (!ok(out)) die(`${name} could not reveal: ${out.refusal || out.status}`);
    });
  }

  const afterReveal = await read(buyerClient, "round", [roundId]);
  record(
    "four bids revealed, one still sealed",
    afterReveal.revealed === 4 && afterReveal.sealed === 1,
    `${afterReveal.revealed} revealed, ${afterReveal.sealed} sealed`,
  );

  await step("award:too-early", async () => {
    console.log("\n  awarding before the reveal window closes");
    await expectRefusal(
      buyerClient,
      "award",
      [roundId],
      0n,
      "award is refused before the reveal window closes",
      "reveal window has not closed",
    );
  });

  // -- scoring -------------------------------------------------------------
  //
  // `sable` is deliberately left until after the reveal window closes, so that
  // "award with one bid unscored" can be proved against the real contract
  // rather than asserted in a comment.

  console.log("\n  scoring against the frozen criteria");
  const scoredNow = revealed.filter((n) => n !== "sable");
  for (const name of scoredNow) {
    await step(`score:${name}`, async () => {
      if (await alreadyAt(name, "scored")) {
        console.log(`    score ${name}: already scored`);
        return;
      }
      const out = await write(buyerClient, "score", [roundId, indexOf(name)], 0n, `score ${name}`);
      if (!ok(out)) {
        console.log(`      ${name}: ${out.refusal || out.status}`);
        // NOT done. `step` marks a step complete unless its callback returns
        // false, so logging the refusal and falling through recorded a scoring
        // call that never landed as finished. A resumed run then skipped it
        // forever, leaving a revealed bid unscored on a round that `award`
        // refuses for exactly that reason - the escrow stuck until the
        // decision window ran out. Scoring is permissionless and retryable, so
        // the honest answer is to leave the step open.
        return false;
      }
    });
  }

  const scored = await read(buyerClient, "bids", [roundId]);
  console.log("\n  scorecards:");
  for (const b of scored.bids) {
    const who = NAMES[b.i] ?? b.bidder.slice(0, 8);
    if (b.status !== "scored") {
      console.log(`    ${who.padEnd(10)} ${b.status}`);
      continue;
    }
    const cells = b.scores.map((s, i) => `${s}/5 ${INFRA_CRITERIA[i].slice(0, 22)}`).join("  |  ");
    console.log(`    ${who.padEnd(10)} total ${String(b.total).padStart(3)}   ${cells}`);
    b.reasons.forEach((r, i) => console.log(`                 c${i + 1}: ${r}`));
  }

  const allScored = scored.bids.filter((b) => b.status === "scored");
  record(
    "each bid the network was asked about is scored",
    allScored.length === scoredNow.length,
    `${allScored.length} of ${scoredNow.length}`,
  );
  record(
    "every published criterion received exactly one score",
    allScored.length > 0 && allScored.every((b) => b.scores.length === INFRA_CRITERIA.length),
  );
  record(
    "every score carries a written reason",
    allScored.every(
      (b) => b.reasons.length === b.scores.length && b.reasons.every((r) => r.trim().length > 2),
    ),
  );
  record(
    "totals are the weighted sums, computed in the contract",
    allScored.every((b) => b.total === b.scores.reduce((s, v, i) => s + v * INFRA_WEIGHTS[i], 0)),
  );
  record("scores are all inside 0..5", allScored.every((b) => b.scores.every((s) => s >= 0 && s <= 5)));
  const neverRevealed = scored.bids.find((b) => b.i === indexOf("orrery"));
  record(
    "the bid that never revealed has no scorecard",
    !neverRevealed || neverRevealed.scores.length === 0,
  );

  await step("score:twice", async () => {
    console.log("\n  scoring the same bid twice");
    await expectRefusal(
      buyerClient,
      "score",
      [roundId, indexOf("meridian")],
      0n,
      "an already scored bid cannot be scored again",
      "not waiting to be scored",
    );
  });

  // -- the appeal ----------------------------------------------------------

  const kestrelIndex = indexOf("kestrel");
  const beforeAppeal = await read(buyerClient, "bid", [roundId, kestrelIndex]);

  await step("appeal:open", async () => {
    console.log("\n  appealing a score");
    const appealed = await write(
      bidders.kestrel.client,
      "appeal_score",
      [roundId, kestrelIndex, KESTREL_APPEAL],
      bond,
      "appeal_score",
    );
    record("a bidder can contest a score", ok(appealed), appealed.refusal);
    state.remember("rounds", "appealTotalBefore", () => beforeAppeal.bid.total);
  });

  await countdown("the reveal window to close", revealAt);

  await step("sweep", async () => {
    console.log("\n  sweeping the commitment that never opened");
    await write(buyerClient, "sweep", [roundId], 0n, "sweep");
  });

  const swept = await read(buyerClient, "round", [roundId]);
  record(
    "a commitment that never revealed expires",
    swept.expired === 1 && swept.sealed === 0,
    `${swept.expired} expired, deposit forfeited: ${fromWei(swept.forfeited)} GEN`,
  );

  await step("award:appeal-open", async () => {
    console.log("\n  awarding while the appeal is open");
    await expectRefusal(
      buyerClient,
      "award",
      [roundId],
      0n,
      "award is held while an appeal is open",
      "appeal is open",
    );
  });

  await step("appeal:resolve", async () => {
    console.log("\n  resolving the appeal");
    await write(buyerClient, "resolve_appeal", [roundId, kestrelIndex], 0n, "resolve_appeal");
  });

  const afterAppeal = await read(buyerClient, "bid", [roundId, kestrelIndex]);
  const totalBefore = state.data.rounds.appealTotalBefore ?? beforeAppeal.bid.total;
  record(
    "the appeal is resolved either way",
    ["upheld", "rejected"].includes(afterAppeal.bid.appeal_status),
    `${afterAppeal.bid.appeal_status}: total ${totalBefore} -> ${afterAppeal.bid.total}`,
  );
  record(
    "the bond comes back only when the total moved",
    afterAppeal.bid.appeal_status === "upheld"
      ? BigInt(afterAppeal.bid.owed) >= bond
      : BigInt(afterAppeal.bid.owed) === 0n,
    `owed ${fromWei(afterAppeal.bid.owed)} GEN`,
  );
  record("a re-scored bid is marked as re-scored", afterAppeal.bid.rescored === true);

  // -- one unscored bid blocks the award -----------------------------------

  await step("award:unscored", async () => {
    console.log("\n  awarding with one bid still unscored");
    await expectRefusal(
      buyerClient,
      "award",
      [roundId],
      0n,
      "one unscored bid blocks the award",
      "must be scored",
    );
  });

  await step("score:sable", async () => {
    console.log("\n  scoring the last bid");
    const out = await write(buyerClient, "score", [roundId, indexOf("sable")], 0n, "score sable");
    record("a bid can still be scored after the reveal window closes", ok(out), out.refusal);
  });

  // -- the appeal window ---------------------------------------------------
  //
  // The last score has just landed, so an award is refused until the appeal
  // window on it closes. That refusal is worth proving on chain rather than
  // waiting through in silence: it is the whole reason a bidder can contest a
  // mark at all, and before it existed a buyer could score and award in the
  // same breath.
  await step("award:window", async () => {
    console.log("\n  the appeal window on the last score is still open");
    await expectRefusal(
      buyerClient,
      "award",
      [roundId],
      0n,
      "awarding inside the appeal window is refused",
      "appeal window",
    );
  });

  // Then wait it out. `countdown` prints progress, which matters on a wait
  // this long, because a silent script looks hung. Fifteen seconds past the
  // instant, since the contract compares against its own clock rather than
  // this machine's.
  const afterScore = await read(buyerClient, "round", [roundId]);
  const closesAt = Date.parse(afterScore.appeal_window_closes);
  if (Number.isFinite(closesAt)) {
    await countdown("the appeal window on the last score to close", closesAt + 15_000);
  }

  // -- the award -----------------------------------------------------------

  await step("award", async () => {
    console.log("\n  awarding");
    const award = await write(buyerClient, "award", [roundId], 0n, "award", true);
    record("the round is awarded", ok(award), award.refusal);
  });

  const final = await read(buyerClient, "round", [roundId]);
  const finalBids = await read(buyerClient, "bids", [roundId]);
  const winner = finalBids.bids.find((b) => b.rank === 1);
  record("the round reads as awarded", final.status === "awarded", final.status);
  record(
    "the highest weighted total wins",
    Boolean(winner) && final.awarded_to.toLowerCase() === winner.bidder.toLowerCase(),
    winner ? `${NAMES[winner.i]} on ${winner.total}` : "no ranked winner",
  );
  record(
    "every scored bid can read its own rank",
    finalBids.bids.filter((b) => b.status === "scored").every((b) => b.rank >= 1),
  );
  record(
    "every scored bid is owed its deposit back",
    finalBids.bids.filter((b) => b.status === "scored").every((b) => BigInt(b.owed) >= deposit),
  );

  await step("claim", async () => {
    console.log("\n  claiming a deposit back");
    const claimed = await write(
      bidders.ninebark.client,
      "claim",
      [roundId, indexOf("ninebark")],
      0n,
      "claim",
      true,
    );
    record("a bidder can pull their deposit", ok(claimed), claimed.refusal);
  });

  console.log("\n  final scoreboard:");
  for (const b of [...finalBids.bids].sort((a, b) => (a.rank || 99) - (b.rank || 99))) {
    const mark = b.rank === 1 ? "*" : " ";
    console.log(
      `   ${mark} ${String(b.rank || "-").padStart(2)}  ${(NAMES[b.i] ?? "").padEnd(10)} ${String(b.total).padStart(3)}  ${b.status}${b.rescored ? "  (re-scored on appeal)" : ""}`,
    );
  }

  if (has("skip-docket")) return summarise();

  // ------------------------------------------------------------------
  // 3. The docket: rounds left open, so the site has live state to show
  // ------------------------------------------------------------------

  console.log("\n  --- the docket ---\n");

  const docket = [
    {
      slug: "review",
      criteria: REVIEW_CRITERIA,
      weights: REVIEW_WEIGHTS,
      title: "Security review, bridge contracts and relayer",
      summary:
        "A written review of the bridge contracts and the relayer, with findings ranked by severity and a re-test after fixes.",
      budget: "25000",
      hours: 36,
      bidders: ["meridian", "sable"],
    },
    {
      slug: "docs",
      criteria: DOCS_CRITERIA,
      weights: DOCS_WEIGHTS,
      title: "Protocol documentation overhaul",
      summary:
        "Rewrite the protocol documentation so every public method of the SDK has a worked example that runs as written.",
      budget: "18000",
      hours: 72,
      bidders: ["ninebark", "kestrel", "sable"],
    },
  ];

  for (const t of docket) {
    await step(`docket:${t.slug}:check`, async () => {
      console.log(`  checking criteria for "${t.title}"`);
      await write(buyerClient, "check_criteria", [t.criteria], 0n, "check_criteria");
    });

    const gate = await read(buyerClient, "check", [criteriaDigest(t.criteria)]);
    record(`"${t.title}" criteria pass the gate`, gate.scorable === true, JSON.stringify(gate.reasons ?? []));
    if (!gate.scorable) continue;

    await step(`docket:${t.slug}:open`, async () => {
      const already = await findExistingRound(t.title);
      if (already !== null) {
        record(`"${t.title}" is open for bids`, true, `round ${already}, already on chain`);
        state.remember("rounds", t.slug, () => already);
        return;
      }
      const out = await write(
        buyerClient,
        "open_round",
        [
          t.title,
          t.summary,
          t.criteria,
          t.weights,
          0,
          isoAt(t.hours * 3600 * 1000),
          isoAt((t.hours + 168) * 3600 * 1000),
          isoAt((t.hours + 336) * 3600 * 1000),
          "",
          12,
        ],
        toWei(t.budget),
        "open_round",
      );
      record(`"${t.title}" is open for bids`, ok(out), out.refusal);
      if (!ok(out)) die(`open_round failed for "${t.title}": ${out.refusal}`);
      const mine = await findExistingRound(t.title);
      if (mine === null) die(`"${t.title}" published but could not be found to identify it.`);
      state.remember("rounds", t.slug, () => mine);
    });

    const id = state.data.rounds[t.slug];
    for (const name of t.bidders) {
      await step(`docket:${t.slug}:commit:${name}`, async () => {
        const salt = state.remember("salts", `${t.slug}:${name}`, () => newSalt());
        const digest = commitmentFor(salt, bidders[name].account.address, PROPOSALS[name]);
        await write(bidders[name].client, "commit", [id, digest], deposit, `commit ${name}`);
      });
    }
  }

  return summarise();
}

function summarise() {
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`  ${results.length - failed.length} of ${results.length} checks passed`);
  if (failed.length) {
    console.log("");
    for (const f of failed) console.log(`  FAILED  ${f.label}  ${f.detail}`);
    process.exitCode = 1;
  }
  console.log("");
}

main().catch((error) => {
  if (error instanceof Abort) console.error(`\n  ${error.message}\n`);
  else console.error(`\n  ${error?.shortMessage ?? error?.message ?? error}\n`);
  console.error("  State was saved. Run the same command again to continue where this stopped.\n");
  summarise();
  process.exitCode = 1;
});
