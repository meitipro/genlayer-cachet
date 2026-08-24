import "server-only";

import { createClient } from "genlayer-js";

import { CACHET, CHAIN, IS_LIVE } from "./chain";
import type {
  Bid,
  BidderRecord,
  BuyerRecord,
  Question,
  Round,
  RoundView,
  Stats,
  Terms,
} from "./types";

/**
 * Server-side reads of the tender contract.
 *
 * There is NO sample data anywhere in this app. Every number on every screen
 * was read from the contract, or the screen says plainly that it could not be
 * read. On a product whose entire claim is that the scoring is verifiable, a
 * fabricated round that renders like a real one is the single worst thing the
 * codebase could contain - so `null` is the only fallback, and the pages are
 * built to say so.
 *
 * Studio allows about 30 `gen_call` a minute and 500 an hour, per IP, across
 * everything on the machine - including a second dev server and any script
 * that happens to be seeding. A round page reads the round and its bids; the
 * home page reads stats and a page of rounds. So every read goes through a
 * short in-process TTL cache, identical concurrent reads share one in-flight
 * promise, and a read that fails serves the last good answer rather than
 * flipping a working page to an error.
 */

const TTL_MS = 12_000;

/**
 * How long a cached answer may still be served AFTER a read fails.
 *
 * Serving the last good answer keeps a working page from going blank over one
 * rate-limited request, which is worth doing. Serving it indefinitely is not:
 * if the contract becomes unreachable for an hour, every page would keep
 * presenting hour-old bid counts and statuses as current, with nothing on
 * screen saying so. Past this the read reports failure and the page says it
 * could not be read - which is the honest answer and the one the rest of this
 * codebase is built around.
 */
const MAX_STALE_MS = 5 * 60_000;

/**
 * Cache entries kept at once.
 *
 * The cache is keyed by call and arguments, and two of those arguments come
 * straight from the URL: any well-formed address reaches `buyer(...)` and any
 * non-negative integer reaches `round(...)`, including ids that do not exist.
 * Unbounded, that is a map an anonymous request can grow forever, holding
 * parsed rounds with every revealed proposal in them.
 *
 * A few hundred entries covers any real working set here - a page of rounds is
 * twelve - so eviction only ever discards something nobody is looking at.
 */
const MAX_ENTRIES = 400;

type Entry = { at: number; value: unknown };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Read through the cache, refreshing recency.
 *
 * A `Map` iterates in insertion order, so deleting and re-setting a key moves
 * it to the end and makes the first key the least recently used.
 */
function touch(key: string): Entry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function remember(key: string, value: unknown): void {
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

function client() {
  // No account: reads only. Passing a bare address here would put genlayer-js
  // into browser-wallet mode, which has no meaning on a server.
  return createClient({ chain: CHAIN });
}

/**
 * "The contract says no such thing" and "we could not ask" are different facts,
 * and collapsing them is the worst bug this file can have.
 *
 * A 404 is a permanent claim about the world; a rate limit is a fact about the
 * last second. Studio allows 30 requests a minute and 500 an hour, shared
 * across every tab and script on the machine, so "we could not ask" is routine
 * - and a real round showing "no such round" because the RPC was busy is a lie
 * the reader has no way to see through.
 *
 * An unrecognised failure classes as `unavailable`, deliberately: claiming a
 * round is gone is the more damaging of the two mistakes.
 */
export type ReadResult<T> =
  | { state: "ok"; value: T }
  | { state: "absent" }
  | { state: "unavailable" };

async function call<T>(functionName: string, args: unknown[] = []): Promise<T | null> {
  if (!IS_LIVE) return null;

  const key = `${functionName}(${JSON.stringify(args)})`;
  const now = Date.now();

  const hit = touch(key);
  if (hit && now - hit.at < TTL_MS) return hit.value as T;

  const running = inflight.get(key);
  if (running) return (await running) as T | null;

  const promise = (async () => {
    try {
      const raw = await client().readContract({
        address: CACHET,
        functionName,
        args: args as never[],
      });
      const parsed = JSON.parse(String(raw)) as T;
      remember(key, parsed);
      return parsed;
    } catch (error) {
      // Serve a stale answer rather than nothing: a page that was live a
      // minute ago should not go blank because one request was rate limited.
      // Past MAX_STALE_MS, stop - at that age it is no longer "the page you
      // were just looking at", it is old data presented as current.
      const stale = cache.get(key);
      if (stale && Date.now() - stale.at < MAX_STALE_MS) return stale.value as T;
      if (stale) cache.delete(key);
      console.error(
        `[cachet] read ${key} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return (await promise) as T | null;
}

/** False when no contract address is configured for this network. */
export const CONFIGURED = IS_LIVE;

export async function getTerms(): Promise<Terms | null> {
  return call<Terms>("terms");
}

export async function getStats(): Promise<Stats | null> {
  return call<Stats>("stats");
}

export async function getRounds(
  offset = 0,
  limit = 12,
): Promise<{ total: number; rounds: Round[] } | null> {
  return call<{ total: number; rounds: Round[] }>("rounds_page", [offset, limit]);
}

/**
 * A round and its bids, read together so the two cannot disagree.
 *
 * `absent` means the contract answered and said there is no such round.
 * `unavailable` means we never got an answer - the caller must offer a retry
 * rather than a 404.
 */
export async function readRound(id: number): Promise<ReadResult<RoundView>> {
  if (!IS_LIVE) return { state: "unavailable" };

  const round = await call<Round & { found?: boolean }>("round", [id]);
  if (round === null) return { state: "unavailable" };
  if (round.found === false) return { state: "absent" };

  const bidData = await call<{ found: boolean; bids: Bid[] }>("bids", [id]);
  return { state: "ok", value: { round, bids: bidData?.bids ?? [] } };
}

/** For callers that genuinely only need the happy path, such as the home page. */
export async function getRound(id: number): Promise<RoundView | null> {
  const result = await readRound(id);
  return result.state === "ok" ? result.value : null;
}

/**
 * The clarifications on a round.
 *
 * Its own read, matching its own view: a round with thirty-two questions is a
 * large response, and the docket pages twelve rounds at a time. The counts
 * ride along on the round itself, so a card never pays for the text.
 */
export async function getQuestions(id: number): Promise<Question[] | null> {
  const data = await call<{ found: boolean; questions: Question[] }>("questions", [id]);
  return data ? (data.questions ?? []) : null;
}

/** A bidder's record: what they entered, opened, scored and won. */
export async function getBidder(address: string): Promise<BidderRecord | null> {
  // Lowercased for the same reason as `getBuyer` below.
  return call<BidderRecord>("bidder", [address.toLowerCase()]);
}

export async function getBuyer(address: string): Promise<BuyerRecord | null> {
  // The contract does `Address(address).as_hex.lower()` before looking anything
  // up, so every casing of one address is one record - but each casing is its
  // own cache key and its own RPC call, out of a budget of thirty a minute.
  // Lowercasing here was checked against the live contract, not assumed: all
  // three casings return the identical record.
  return call<BuyerRecord>("buyer", [address.toLowerCase()]);
}
