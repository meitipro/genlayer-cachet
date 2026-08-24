/**
 * Shared plumbing for the deploy, seed and e2e scripts.
 *
 * Everything in here exists because of something Studio actually did, not
 * because it seemed prudent. The comments say which.
 */
import dns from "node:dns";
import { createHash, randomBytes } from "node:crypto";

import { createAccount, createClient } from "genlayer-js";
import { studionet, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

/**
 * Studio is behind Cloudflare on both stacks and its AAAA addresses time out.
 * Node tries IPv6 first, so every request pays ~10s before falling back, which
 * reads as "the RPC keeps dropping connections" and produces a long run of
 * spurious ECONNRESET retries. Set once here; every script imports this module.
 */
dns.setDefaultResultOrder("ipv4first");

export const GEN = 10n ** 18n;

/**
 * Thrown rather than exiting on the spot: process.exit() while the RPC socket
 * is still open trips a libuv assertion on Windows and buries the real message
 * under a C-level stack trace.
 */
export class Abort extends Error {}

export function die(message) {
  throw new Abort(message);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

export const has = (name) => process.argv.includes(`--${name}`);

/**
 * Every string an error carries, flattened.
 *
 * viem buries the RPC's own sentence: `shortMessage` is the useless "An
 * unknown RPC error occurred." while "Rate limit exceeded: 30 requests per
 * minute" sits in `details`, or two levels down in `cause`. Matching on
 * shortMessage alone misses exactly the failure that most needs retrying.
 */
export function errorText(error) {
  const seen = new Set();
  const parts = [];
  let node = error;
  for (let depth = 0; node && depth < 6; depth++) {
    if (seen.has(node)) break;
    seen.add(node);
    for (const key of ["shortMessage", "details", "message", "name"]) {
      const value = node?.[key];
      if (typeof value === "string") parts.push(value);
    }
    node = node.cause;
  }
  if (!parts.length) parts.push(String(error));
  return parts.join(" | ");
}

export const isRateLimited = (text) => /rate limit|429|-32429/i.test(text);

/**
 * Studio enforces TWO limits, and only one of them is survivable by waiting a
 * minute:
 *
 *   "Rate limit exceeded: 30 requests per minute"   -> wait ~65s, carry on.
 *   "Rate limit exceeded: 500 requests per hour"    -> the hour's budget is
 *                                                      gone. 65s achieves
 *                                                      nothing; six retries at
 *                                                      65s just burn the
 *                                                      script's patience and
 *                                                      report a failure that
 *                                                      is not one.
 *
 * The hourly cap is shared across everything on the IP - every script, every
 * server-side read the dev server makes, every browser refresh - which is why
 * a long run and a browsing session at the same time is what exhausts it.
 */
export const isHourlyLimited = (text) => /per hour/i.test(text);
export const isFlaky = (text) =>
  /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|CONNECT_TIMEOUT|EAI_AGAIN|other side closed/i.test(
    text,
  );

/**
 * "Timed out while waiting for transaction  to be confirmed."
 *
 * This is genlayer-js giving up on ITS poll loop, not the chain giving up on
 * the transaction. The transaction is submitted, it has a hash, and it is
 * still settling - every dropped request along the way ate part of the retry
 * budget without the transaction being any less real.
 *
 * Treating this as a failure is how a run concludes that publishing did not
 * work, and publishes a SECOND tender escrowing a second budget. It is
 * retryable, and the caller must also be idempotent; both halves are needed.
 */
export const isPollTimeout = (text) =>
  /timed out while waiting|timeout while waiting|transaction .* to be confirmed/i.test(text);

/** The same switch lib/chain.ts uses, so a deploy cannot land on a network the site does not read. */
export function pickChain() {
  const raw = (process.env.NEXT_PUBLIC_GENLAYER_NETWORK || "studionet")
    .trim()
    .toLowerCase();
  const bradbury =
    raw === "bradbury" || raw === "testnet_bradbury" || raw === "testnetbradbury";
  return bradbury ? testnetBradbury : studionet;
}

export const isStudio = (chain) => chain.id === studionet.id;

/**
 * Scale GEN to wei in two steps.
 *
 * Math.round(value * 1e18) overflows float64's 53-bit mantissa and is silently
 * wrong for roughly one value in eleven - 0.009 becomes ...8999999999999999.
 * Spot-checking hides it, because the round numbers people test with happen to
 * be exact.
 */
export function toWei(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) die(`"${amount}" is not a number of GEN.`);
  return BigInt(Math.round(value * 1e9)) * (GEN / 10n ** 9n);
}

export const fromWei = (wei) => Number((BigInt(wei) * 10000n) / GEN) / 10000;

/**
 * Studio allows 30 requests per minute per IP across everything.
 *
 * genlayer-js polls eth_getTransactionByHash on a fast default interval, so a
 * single wait can burn the whole minute's budget and the next call comes back
 * rate limited - which looks exactly like a broken deploy and is not one.
 * Six seconds is ten requests a minute per wait, leaving room for the rest of
 * the script.
 */
export const POLL = { interval: 8000, retries: 220 };

/**
 * Wait, and treat the rate limiter as weather rather than as an error.
 *
 * The limit is shared across everything on the IP, so another script - or the
 * site's own dev server polling in the background - can push a wait over the
 * edge through no fault of this one. A submitted transaction does not care: it
 * keeps settling while we back off. Failing here would abandon a deploy that is
 * going to succeed and leave an orphan contract nobody wrote the address down for.
 */
async function waitFor(client, hash, status, label) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      return await client.waitForTransactionReceipt({ hash, status, ...POLL });
    } catch (error) {
      const text = errorText(error);
      const hourly = isHourlyLimited(text);
      const limited = isRateLimited(text);
      const timedOut = isPollTimeout(text);
      if (!(limited || isFlaky(text) || timedOut) || attempt === 8) throw error;
      const pause = hourly ? 600_000 : limited ? 65_000 : 5_000 * attempt;
      const why = hourly
        ? "the hour's request budget is spent"
        : limited
          ? "rate limited"
          : timedOut
            ? "the poll loop gave up"
            : "connection dropped";
      console.log(
        `    ${label}: ${why}, the transaction is still settling - waiting ${Math.round(pause / 60_000) || "<1"}m`,
      );
      await sleep(pause);
    }
  }
}

export async function waitAccepted(client, hash, label) {
  const receipt = await waitFor(client, hash, TransactionStatus.ACCEPTED, label);
  console.log(`    ${label} accepted`);
  return receipt;
}

export async function waitFinal(client, hash, label) {
  await waitFor(client, hash, TransactionStatus.ACCEPTED, label);
  const receipt = await waitFor(client, hash, TransactionStatus.FINALIZED, label);
  console.log(`    ${label} finalized`);
  return receipt;
}

/**
 * genlayer-js's deployContract estimates gas itself, and if that one RPC call
 * drops it silently falls back to a hardcoded 200_000 gas rather than retrying.
 * For a contract this size that is not enough, the chain answers "intrinsic gas
 * too low" before consensus, and nothing is spent. Retrying the whole call is
 * the only lever from outside. A real contract error looks nothing like this
 * and is left to propagate.
 */
export async function deployWithRetry(client, code, args, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await client.deployContract({ code, args });
    } catch (e) {
      const msg = errorText(e);
      const starved = /intrinsic gas too low/i.test(msg);
      if ((starved || isFlaky(msg) || isRateLimited(msg)) && i < attempts) {
        console.log(
          `  attempt ${i} hit a transient rpc hiccup (${starved ? "gas estimation fell back too low" : "connection dropped"}), nothing was spent - retrying`,
        );
        await sleep(2500 * i);
        continue;
      }
      throw e;
    }
  }
}

/**
 * Send a write, retrying the failures that happen while sending.
 *
 * "Nothing was sent" is a HOPE, not a fact. Observed on Studio 2026-08-08: a
 * reveal reported `fetch failed` on `eth_sendRawTransaction`, the retry sent a
 * second copy, and the second came back "this bid was already handled" -
 * because the first had landed and only its RESPONSE was lost. The run then
 * died on a transaction that had worked.
 *
 * So this retry cannot be the only defence. Every caller doing something
 * expensive or irreversible must ALSO check the chain for its own effect
 * before repeating it - see `alreadyAt` and `findExistingRound` in seed.mjs.
 * On a payable method the difference is a second escrowed budget.
 */
export async function sendWithRetry(client, args, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await client.writeContract(args);
    } catch (error) {
      const text = errorText(error);
      const limited = isRateLimited(text);
      if (!(limited || isFlaky(text)) || attempt === attempts) throw error;
      const pause = limited ? 65_000 : 4_000 * attempt;
      console.log(
        `    ${args.functionName}: ${limited ? "rate limited" : "connection dropped"} before submission, nothing was sent - retrying in ${Math.round(pause / 1000)}s`,
      );
      await sleep(pause);
    }
  }
}

export async function readWithRetry(client, args, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await client.readContract(args);
    } catch (error) {
      const text = errorText(error);
      const limited = isRateLimited(text);
      if (!(limited || isFlaky(text)) || attempt === attempts) throw error;
      await sleep(limited ? 65_000 : 3_000 * attempt);
    }
  }
}

export function addressFrom(receipt) {
  return (
    receipt?.data?.contract_address ??
    receipt?.contract_address ??
    receipt?.contractAddress ??
    null
  );
}

/**
 * The refusal message a contract wrote for a person to read.
 *
 * Verified against a real Studio receipt on 2026-08-08, because guessing this
 * costs a whole seed run. Three fields are easy to confuse and only ONE of
 * them answers "did my code succeed":
 *
 *   receipt.status / status_name        7 / FINALIZED
 *       The TRANSACTION's state. A refused call finalizes perfectly well.
 *   receipt.result / result_name        6 / MAJORITY_AGREE
 *       The CONSENSUS outcome. Validators agreeing that the call failed is
 *       still agreement.
 *   leader_receipt[0].execution_result  SUCCESS | ERROR
 *       The actual answer.
 *
 * `genvm_result.stderr` is EMPTY for a clean refusal - reading stderr and
 * finding nothing is what makes a working refusal look like a silent failure.
 * The sentence lives in `leader_receipt[0].result.payload` as PLAIN TEXT,
 * beside a `status` of "rollback" (gl.advanced.user_error_immediate) or
 * "contract_error" (a raised gl.vm.UserError).
 */
/**
 * The round that actually executed the contract.
 *
 * `leader_receipt` is an ARRAY, and index 0 is NOT reliably the leader - later
 * entries are validators, whose `execution_result` is routinely `ERROR` with
 * "Validator execution cancelled after quorum", which is normal and means
 * nothing went wrong. Reading index 0, or scanning the array for the first
 * entry that errored, reports a cancelled validator as the contract's own
 * answer and puts its sentence in front of a user as the reason their call
 * failed.
 */
function leaderRound(receipt) {
  const raw = receipt?.consensus_data?.leader_receipt;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!list.length) return null;
  return list.find((entry) => entry?.mode === 'leader') ?? list[0] ?? null;
}

export function refusalOf(receipt) {
  // Only a round that actually ERRORED has a refusal. A successful round
  // carries a payload too - it is the encoded return value, and on a `-> None`
  // method it decodes to noise like "idle". Printing that as the reason a call
  // failed, beside a check that passed, is worse than printing nothing.
  const round = leaderRound(receipt);
  if (!round || round.execution_result !== 'ERROR') return '';
  const payload = round.result?.payload;
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  const stderr = round.genvm_result?.stderr;
  return typeof stderr === 'string' ? stderr.trim() : '';
}

/** SUCCESS or ERROR: what the CONTRACT did, not what the transaction did. */
export function statusOf(receipt) {
  const executed = leaderRound(receipt)?.execution_result;
  if (typeof executed === 'string') return executed;
  // Nothing executed at all, so report the transaction state instead: a
  // LEADER_TIMEOUT or UNDETERMINED must not read as a success.
  return receipt?.status_name ?? String(receipt?.status ?? 'unknown');
}

export const succeeded = (receipt) => statusOf(receipt) === 'SUCCESS';

/**
 * Studio's programmatic faucet.
 *
 * sim_fundAccount funds an arbitrary address and finalizes, so an end-to-end
 * run with several bidders needs no human and no faucet button. Note that
 * eth_getBalance still answers 0x0 afterwards - the funding is real, the
 * balance read is not, so never treat a zero here as "funding failed".
 */
export async function fundAccount(chain, address, gen) {
  const res = await fetch(chain.rpcUrls.default.http[0], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sim_fundAccount",
      params: [address, Number(toWei(gen))],
    }),
  });
  const body = await res.json();
  if (body.error) die(`sim_fundAccount failed for ${address}: ${JSON.stringify(body.error)}`);
  return body.result;
}

/**
 * The sealed commitment, in JavaScript.
 *
 * MUST stay byte-identical to `commitment_for` in contracts/cachet.py. The
 * bidder's address is inside the hash so a commitment copied out of public
 * state cannot be revealed by the copier, and the salt is what stops a short
 * proposal being brute-forced out of the digest during the commit window.
 */
export function commitmentFor(salt, bidder, proposal) {
  return createHash("sha256")
    .update(`${salt}\n${String(bidder).toLowerCase()}\n${proposal}`, "utf8")
    .digest("hex");
}

export const newSalt = () => randomBytes(16).toString("hex");

/** The digest open_round matches against a stored scorability verdict. */
export function criteriaDigest(texts) {
  const normalised = texts.map((t) =>
    String(t).split(/\s+/).filter(Boolean).join(" ").trim().toLowerCase().slice(0, 160),
  );
  return createHash("sha256").update(normalised.join("\n"), "utf8").digest("hex");
}

/** Canonical UTC, the one spelling the contract stores windows in. */
export const isoAt = (msFromNow) =>
  new Date(Date.now() + msFromNow).toISOString().replace(/\.\d+Z$/, "Z");

export async function countdown(label, untilMs) {
  const remaining = untilMs - Date.now();
  if (remaining <= 0) return;
  console.log(`\n  waiting ${Math.ceil(remaining / 1000)}s for ${label}`);
  let left = remaining;
  while (left > 0) {
    const step = Math.min(left, 30_000);
    await sleep(step);
    left -= step;
    if (left > 0) console.log(`    ${Math.ceil(left / 1000)}s`);
  }
  // The contract compares `>` against the stored close time, so a wait that
  // lands exactly on the boundary is still inside the window. Overshoot.
  await sleep(4000);
}

export function makeClient(key, chain) {
  const account = createAccount(key);
  return { account, client: createClient({ chain, account }) };
}

export { studionet, testnetBradbury, TransactionStatus, createAccount, createClient };
