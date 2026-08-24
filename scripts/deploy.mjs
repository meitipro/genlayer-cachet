/**
 * Deploy the Cachet tender contract.
 *
 *   $env:CACHET_DEPLOYER_KEY = "0x..."     # PowerShell
 *   npm run deploy -- --yes
 *
 * The key is read from the environment and never from an argument, because
 * arguments end up in shell history and in the process list. It is never
 * printed; only the derived address is, so you can check you are spending from
 * the account you meant to.
 *
 * On Studio, pass --fund to have sim_fundAccount top the deployer up first.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import {
  Abort,
  addressFrom,
  deployWithRetry,
  die,
  flag,
  fromWei,
  fundAccount,
  has,
  isStudio,
  makeClient,
  pickChain,
  toWei,
  waitFinal,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CONTRACT = join(ROOT, "contracts", "cachet.py");

async function main() {
  const key = process.env.CACHET_DEPLOYER_KEY;
  const chain = pickChain();

  if (!key) {
    die(
      [
        "CACHET_DEPLOYER_KEY is not set.",
        "",
        '  PowerShell:  $env:CACHET_DEPLOYER_KEY = "0x..."',
        "  bash:        export CACHET_DEPLOYER_KEY=0x...",
      ].join("\n"),
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    die("CACHET_DEPLOYER_KEY is not a 32 byte hex private key (0x + 64 hex).");
  }

  const feeBps = Number(flag("fee", "250"));
  const depositGen = flag("deposit", "5");
  const bondGen = flag("bond", "10");

  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) {
    die("--fee must be a whole number of basis points between 0 and 1000.");
  }

  const { account, client } = makeClient(key, chain);
  const treasury = flag("treasury", account.address);
  /**
   * Line endings normalised before the source goes on chain.
   *
   * Git stores this file with LF (see .gitattributes) but checks it out with
   * CRLF on Windows, and the deploy sends whatever is on disk. That is 2.4 KB
   * of carriage returns paid for in on-chain bytes, on a payload whose size is
   * already the thing most likely to make the deploy fail - and it means the
   * deployed source would not be byte-identical to the repo it came from.
   */
  const code = readFileSync(CONTRACT, "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  const depositWei = toWei(depositGen);
  const bondWei = toWei(bondGen);

  let balance = 0n;
  try {
    balance = await client.getBalance({ address: account.address });
  } catch (e) {
    die(
      `Could not reach ${chain.rpcUrls.default.http[0]} to read the balance.\n  ${e?.shortMessage ?? e?.message ?? e}`,
    );
  }

  const studio = isStudio(chain);
  if (balance === 0n && !studio) {
    die(
      [
        `${account.address} holds no GEN, so the deployment would fail.`,
        "",
        "  Fund it from the faucet, then run this again:",
        "  https://testnet-faucet.genlayer.foundation/",
      ].join("\n"),
    );
  }

  console.log("");
  console.log("  contract       contracts/cachet.py");
  const codeBytes = Buffer.byteLength(code, "utf8");
  console.log(`  bytes          ${codeBytes.toLocaleString("en-US")}`);
  console.log(`  network        ${chain.name} (chain ${chain.id})`);
  console.log(`  rpc            ${chain.rpcUrls.default.http[0]}`);
  console.log(`  deployer       ${account.address}`);
  console.log(`  treasury       ${treasury}`);
  console.log(
    `  balance        ${fromWei(balance)} GEN${balance === 0n && studio ? "   (expected on Studio: eth_getBalance reads 0 even when funded)" : ""}`,
  );
  console.log(`  round fee      ${feeBps} bps  (${feeBps / 100}% of an awarded budget, never on a decline)`);
  console.log(`  entry deposit  ${depositGen} GEN  (${depositWei} wei)`);
  console.log(`  appeal bond    ${bondGen} GEN  (${bondWei} wei)`);
  console.log("");
  console.log("  All three are copied onto every round at publication, so changing");
  console.log("  them later cannot reach a tender whose bidders already read the terms.");
  console.log("");

  // Size is the likeliest reason a Studio deploy fails, and it never reports
  // itself as one: the RPC resets the request body, genlayer-js shrugs off the
  // gas estimate and then dies on eth_sendRawTransaction. Measured on Studio,
  // deploys are reliable below ~55 KB and get progressively worse above it. Say
  // so BEFORE the attempt, so a failure is a known cause rather than a mystery.
  if (codeBytes > 55_000) {
    console.log(`  NOTE  this payload is ${(codeBytes / 1024).toFixed(1)} KB, above the ~55 KB where Studio`);
    console.log("        deploys start needing retries. Eight are made automatically with a");
    console.log("        growing backoff. If they all fail, deploy a tiny contract to tell a");
    console.log("        size problem from an outage - that takes a minute and settles it.");
    console.log("");
  }

  if (!has("yes")) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question("  Deploy this? Type yes to continue: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") die("Nothing was deployed.");
  }

  if (has("fund") && studio) {
    console.log("\n  funding the deployer");
    await fundAccount(chain, account.address, flag("fund-amount", "1000000"));
    console.log("    funded");
  }

  console.log("\n  deploying");
  const hash = await deployWithRetry(client, code, [
    treasury,
    feeBps,
    depositWei,
    bondWei,
  ]);
  console.log(`  tx             ${hash}`);

  const receipt = await waitFinal(client, hash, "  cachet");
  const address = addressFrom(receipt);
  if (!address) {
    die(
      [
        "The deploy finalized but no contract address came back in the receipt.",
        `  Check the transaction directly: ${hash}`,
      ].join("\n"),
    );
  }

  console.log(`\n  cachet         ${address}\n`);
  console.log("  Point the site at it:");
  console.log(`    NEXT_PUBLIC_CACHET_ADDRESS=${address}`);
  console.log("");
  console.log("  Keep the address EXACTLY as printed. gen_call needs the EIP-55");
  console.log("  checksummed spelling - the all-lowercase form of a live contract");
  console.log('  answers "Contract not found", and every page then reports that it');
  console.log("  could not read the chain, on a contract that is running perfectly.");
  console.log("");
  console.log("  NEXT_PUBLIC_ variables are inlined at build time, so setting this in");
  console.log("  a hosting dashboard does nothing until the next redeploy.");
  console.log("");
  console.log("  Run a real tender through it:");
  console.log(`    npm run seed -- --address=${address}`);
  console.log("");
}

if (process.argv[1] && process.argv[1].endsWith("deploy.mjs")) {
  main().catch((error) => {
    if (error instanceof Abort) console.error(`\n  ${error.message}\n`);
    else console.error(`\n  ${error?.shortMessage ?? error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
