/**
 * What the deployed contract currently holds.
 *
 *   npm run status -- --address=0x...
 *
 * Read-only and cheap: one `stats`, one `rounds_page`, and one `bids` per
 * round. Useful on its own, and the thing to run first when a seed run dies
 * halfway and you need to know what actually landed.
 */
import { Abort, die, flag, fromWei, makeClient, pickChain, readWithRetry } from "./lib.mjs";

const chain = pickChain();
const ADDRESS = flag("address", process.env.NEXT_PUBLIC_CACHET_ADDRESS || "");

async function main() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(ADDRESS)) {
    die("Pass the deployed contract:  node scripts/status.mjs --address=0x...");
  }

  // Reads need no account. A key here would be pointless risk.
  const { client } = makeClient(
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    chain,
  );
  const read = async (fn, args = []) =>
    JSON.parse(String(await readWithRetry(client, { address: ADDRESS, functionName: fn, args })));

  const now = Date.now();
  const stats = await read("stats");
  const page = await read("rounds_page", [0, 24]);

  console.log("");
  console.log(`  ${chain.name}  ${ADDRESS}`);
  console.log("");
  console.log(
    `  rounds ${stats.rounds}   awarded ${stats.awarded}   declined ${stats.declined}   open ${stats.rounds - stats.awarded - stats.declined}`,
  );
  console.log(
    `  bids   sealed ${stats.bids_sealed}   scored ${stats.bids_scored}   appeals ${stats.appeals} (${stats.appeals_upheld} upheld)`,
  );
  console.log(
    `  value  escrowed ${fromWei(stats.escrowed)} GEN   paid ${fromWei(stats.paid)} GEN   fees ${fromWei(stats.fees)} GEN`,
  );
  console.log("");

  for (const r of page.rounds) {
    const phase =
      r.status !== "open"
        ? r.status
        : now <= Date.parse(r.commit_closes)
          ? "commit"
          : now <= Date.parse(r.reveal_closes)
            ? "reveal"
            : "decide";
    console.log(`  R${r.id}  ${r.title}`);
    console.log(
      `        ${phase.padEnd(9)} ${fromWei(r.budget)} GEN   ${r.criteria.length} criteria   ${r.bids} bids` +
        `  (sealed ${r.sealed}, revealed ${r.revealed}, scored ${r.scored}, expired ${r.expired}` +
        `${r.withdrawn ? `, withdrawn ${r.withdrawn}` : ""})`,
    );
    console.log(
      `        commit ${r.commit_closes}  reveal ${r.reveal_closes}  decide ${r.decide_closes}`,
    );
    if (r.status === "awarded") {
      console.log(`        awarded ${r.awarded_to} on ${r.awarded_total}`);
    }
    if (r.status === "declined") console.log(`        declined: ${r.decline_reason}`);
    if (r.appeals_open) console.log(`        ${r.appeals_open} appeal(s) open`);
    if (r.questions) {
      console.log(`        ${r.questions} question(s), ${r.questions_unanswered} unanswered`);
    }

    // `rows`, not `bids`: `bids` counts the ones in play, so a round whose only
    // commitment was withdrawn reports zero and this listing would skip the row
    // that explains what happened.
    if (r.rows > 0) {
      const data = await read("bids", [r.id]);
      for (const b of data.bids) {
        const scores = b.scores.length ? b.scores.join("/") : " - ";
        console.log(
          `          bid ${b.i}  ${b.bidder.slice(0, 10)}  ${b.status.padEnd(9)} ${scores.padEnd(12)} total ${String(b.total).padStart(3)}  rank ${b.rank || "-"}${b.rescored ? "  re-scored" : ""}${b.amendments ? `  amended x${b.amendments}` : ""}`,
        );
      }
    }
    console.log("");
  }
}

main().catch((error) => {
  if (error instanceof Abort) console.error(`\n  ${error.message}\n`);
  else console.error(`\n  ${error?.shortMessage ?? error?.message ?? error}\n`);
  process.exitCode = 1;
});
