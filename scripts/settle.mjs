/**
 * Settle a round by hand.
 *
 *   node scripts/settle.mjs --address=0x... --round=0 --action=decline --why="no bid met the bar"
 *   node scripts/settle.mjs --address=0x... --round=0 --action=award
 *   node scripts/settle.mjs --address=0x... --round=0 --action=expire
 *   node scripts/settle.mjs --address=0x... --round=0 --action=sweep
 *   node scripts/settle.mjs --address=0x... --round=0 --action=score --bid=2
 *
 * The seed script drives a whole round on a schedule; this is for the rounds
 * that need a decision at a moment nobody planned for - the tender nobody bid
 * into, the bid the network could not reach agreement on the first time, the
 * round whose buyer has gone quiet and whose decision window has passed.
 *
 * Every action here is one the contract already allows the caller to take.
 * `award` and `expire` are permissionless after the decision window; `decline`
 * is the buyer's and only inside it.
 */
import {
  Abort,
  die,
  flag,
  makeClient,
  pickChain,
  readWithRetry,
  refusalOf,
  sendWithRetry,
  statusOf,
  waitFinal,
} from "./lib.mjs";

const chain = pickChain();
const ADDRESS = flag("address", process.env.NEXT_PUBLIC_CACHET_ADDRESS || "");

const ACTIONS = {
  decline: (round, why) => ["decline", [round, why]],
  award: (round) => ["award", [round]],
  expire: (round) => ["expire", [round]],
  sweep: (round) => ["sweep", [round]],
  collect: (round) => ["collect_forfeits", [round]],
  score: (round, _why, bid) => ["score", [round, bid]],
  resolve: (round, _why, bid) => ["resolve_appeal", [round, bid]],
};

async function main() {
  const key = process.env.CACHET_DEPLOYER_KEY;
  if (!key) die('CACHET_DEPLOYER_KEY is not set.  PowerShell:  $env:CACHET_DEPLOYER_KEY = "0x..."');
  if (!/^0x[0-9a-fA-F]{40}$/.test(ADDRESS)) die("Pass --address=0x...");

  const round = Number(flag("round", "-1"));
  const bid = Number(flag("bid", "-1"));
  const action = flag("action", "");
  const why = flag("why", "no bid met the published bar");

  if (!Number.isInteger(round) || round < 0) die("Pass --round=<id>");
  if (!ACTIONS[action]) die(`--action must be one of: ${Object.keys(ACTIONS).join(", ")}`);
  if ((action === "score" || action === "resolve") && bid < 0) die("Pass --bid=<index>");

  const { account, client } = makeClient(key, chain);
  const [fn, args] = ACTIONS[action](round, why, bid);

  const before = JSON.parse(
    String(await readWithRetry(client, { address: ADDRESS, functionName: "round", args: [round] })),
  );
  if (before.found === false) die(`Round ${round} does not exist.`);

  console.log("");
  console.log(`  contract   ${ADDRESS}`);
  console.log(`  caller     ${account.address}`);
  console.log(`  round      ${round} - ${before.title}`);
  console.log(`  status     ${before.status}, ${before.bids} bids (${before.scored} scored)`);
  console.log(`  windows    commit ${before.commit_closes}  reveal ${before.reveal_closes}  decide ${before.decide_closes}`);
  console.log(`  now        ${new Date().toISOString()}`);
  console.log(`  calling    ${fn}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
  console.log("");

  const hash = await sendWithRetry(client, { address: ADDRESS, functionName: fn, args, value: 0n });
  const receipt = await waitFinal(client, hash, `  ${fn}`);
  const status = statusOf(receipt);

  if (status === "SUCCESS") {
    const after = JSON.parse(
      String(await readWithRetry(client, { address: ADDRESS, functionName: "round", args: [round] })),
    );
    console.log(`\n  done. round ${round} is now "${after.status}".`);
    if (after.status === "awarded") {
      console.log(`  awarded ${after.awarded_to} on a weighted total of ${after.awarded_total}`);
    }
    if (after.status === "declined") console.log(`  reason: ${after.decline_reason}`);
    console.log("");
    return;
  }

  console.log(`\n  refused: ${refusalOf(receipt) || status}\n`);
  process.exitCode = 1;
}

main().catch((error) => {
  if (error instanceof Abort) console.error(`\n  ${error.message}\n`);
  else console.error(`\n  ${error?.shortMessage ?? error?.message ?? error}\n`);
  process.exitCode = 1;
});
