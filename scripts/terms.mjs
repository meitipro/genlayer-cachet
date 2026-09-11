/**
 * Set the terms the NEXT round is published under.
 *
 *   node scripts/terms.mjs --address=0x... --fee=250 --deposit=5 --bond=10
 *
 * Owner only, signed with CACHET_DEPLOYER_KEY. The defaults are the ones
 * `npm run deploy` uses.
 *
 * Why this exists: a deployment made any other way - the Studio UI, a script
 * with its arguments left out - can land with all three at zero. Nothing
 * refuses that, and nothing looks wrong until someone tries to walk the value
 * paths: no deposit to forfeit, no bond to put at risk, nothing for a bidder
 * to claim. The contract has always had `set_terms` for exactly this, and
 * nothing called it.
 *
 * Every published round keeps the copy of the terms it was published with, so
 * this never reaches a round that already exists. Run it BEFORE publishing.
 */
import {
  Abort,
  die,
  flag,
  fromWei,
  makeClient,
  pickChain,
  readWithRetry,
  refusalOf,
  sendWithRetry,
  statusOf,
  toWei,
  waitFinal,
} from "./lib.mjs";

const chain = pickChain();
const ADDRESS = flag("address", process.env.NEXT_PUBLIC_CACHET_ADDRESS || "");

async function readTerms(client) {
  return JSON.parse(
    String(await readWithRetry(client, { address: ADDRESS, functionName: "terms", args: [] })),
  );
}

async function main() {
  const key = process.env.CACHET_DEPLOYER_KEY;
  if (!key) die('CACHET_DEPLOYER_KEY is not set.  PowerShell:  $env:CACHET_DEPLOYER_KEY = "0x..."');
  if (!/^0x[0-9a-fA-F]{40}$/.test(ADDRESS)) die("Pass --address=0x...");

  const feeBps = Number(flag("fee", "250"));
  const depositGen = flag("deposit", "5");
  const bondGen = flag("bond", "10");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) {
    die("--fee must be a whole number of basis points between 0 and 1000.");
  }

  const { account, client } = makeClient(key, chain);
  const before = await readTerms(client);

  // Fail here, in words, rather than spend a transaction to be told the same.
  if (String(before.owner).toLowerCase() !== account.address.toLowerCase()) {
    die(`Only the owner can set terms. The owner is ${before.owner}; this key is ${account.address}.`);
  }

  const depositWei = toWei(depositGen);
  const bondWei = toWei(bondGen);

  console.log("");
  console.log(`  contract       ${ADDRESS}`);
  console.log(`  owner          ${account.address}`);
  console.log(`  fee            ${before.fee_bps} bps  ->  ${feeBps} bps`);
  console.log(`  entry deposit  ${fromWei(before.entry_deposit)} GEN  ->  ${depositGen} GEN`);
  console.log(`  appeal bond    ${fromWei(before.appeal_bond)} GEN  ->  ${bondGen} GEN`);
  console.log("");

  const hash = await sendWithRetry(client, {
    address: ADDRESS,
    functionName: "set_terms",
    args: [feeBps, depositWei, bondWei],
    value: 0n,
  });
  const receipt = await waitFinal(client, hash, "  set_terms");
  const status = statusOf(receipt);
  if (status !== "SUCCESS") {
    console.log(`\n  refused: ${refusalOf(receipt) || status}\n`);
    process.exitCode = 1;
    return;
  }

  const after = await readTerms(client);
  console.log(
    `\n  done. The next round published takes a ${fromWei(after.entry_deposit)} GEN entry ` +
      `deposit, a ${fromWei(after.appeal_bond)} GEN appeal bond and a ${after.fee_bps} bps fee.`,
  );
  console.log("  Rounds that already exist keep the terms they were published with.\n");
}

main().catch((error) => {
  if (error instanceof Abort) console.error(`\n  ${error.message}\n`);
  else console.error(`\n  ${error?.shortMessage ?? error?.message ?? error}\n`);
  process.exitCode = 1;
});
