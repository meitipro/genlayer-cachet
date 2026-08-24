import type { Bid, Phase, Round } from "./types";

/**
 * Wei to a readable number of GEN.
 *
 * Done entirely in BigInt. A 40,000 GEN budget is 4e22 wei, which is far past
 * Number.MAX_SAFE_INTEGER - Number(wei) / 1e18 loses the low digits silently,
 * and the number it loses them from is the one on the award screen.
 */
export function formatGen(wei: string | bigint, decimals = 0): string {
  let value: bigint;
  try {
    value = BigInt(wei);
  } catch {
    return "0";
  }
  const unit = 10n ** 18n;
  const whole = value / unit;
  if (decimals <= 0) {
    const remainder = value % unit;
    // Round the whole number rather than truncating, so 0.9 GEN is not "0".
    const rounded = remainder * 2n >= unit ? whole + 1n : whole;
    return rounded.toLocaleString("en-US");
  }
  const scale = 10n ** BigInt(decimals);
  const frac = ((value % unit) * scale) / unit;
  const text = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return text ? `${whole.toLocaleString("en-US")}.${text}` : whole.toLocaleString("en-US");
}

/**
 * An address, shortened, with the elision made obvious.
 *
 * The separator is load-bearing and must NOT be omitted: `0x84ce414B` is valid
 * hex and reads as a whole address, so a truncation with nothing in the middle
 * is worse than no truncation at all. A hyphen cannot appear in hex, so
 * `0x84ce-414B` can only ever be read as "something was cut out here".
 */
export function shortAddress(address: string, size = 4): string {
  if (!address) return "-";
  if (address.length < 2 * size + 4) return address;
  return `${address.slice(0, size + 2)}-${address.slice(-size)}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * A stored timestamp as a short date.
 *
 * Parsed and rendered in UTC on purpose. Every window in the contract is a UTC
 * instant, and rendering a deadline in the reader's local zone means two
 * bidders see two different closing times for the same tender.
 */
export function formatDate(iso: string, withTime = false): string {
  // Bare, not padded: this lands inside sentences and separator lists, where a
  // spaced hyphen reads as a broken connector rather than an absent value.
  if (!iso) return "-";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const day = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
  const year = at.getUTCFullYear();
  const now = new Date();
  const stamp = year === now.getUTCFullYear() ? day : `${day} ${year}`;
  if (!withTime) return stamp;
  const hh = String(at.getUTCHours()).padStart(2, "0");
  const mm = String(at.getUTCMinutes()).padStart(2, "0");
  return `${stamp}, ${hh}:${mm} UTC`;
}

export function timeUntil(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  const delta = at - now;
  const abs = Math.abs(delta);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const span =
    days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return delta >= 0 ? `in ${span}` : `${span} ago`;
}

/**
 * The same gap, but precise enough to watch tick.
 *
 * `timeUntil` bottoms out at "in 0m", which is fine for a stamp rendered once
 * and useless for a counter someone is watching to decide whether they still
 * have time to submit. Below ten minutes this shows seconds, because that is
 * the range where the answer changes what the reader does.
 *
 * Pure and clock-injected so the server and the browser can produce the same
 * string from the same instant - which is what keeps hydration quiet.
 */
export function countdown(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  const delta = at - now;
  const abs = Math.abs(delta);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  let span: string;
  if (days > 0) span = `${days}d ${hours}h`;
  else if (hours > 0) span = `${hours}h ${pad(minutes)}m`;
  else if (minutes >= 10) span = `${minutes}m`;
  else if (minutes > 0) span = `${minutes}m ${pad(seconds)}s`;
  else span = `${seconds}s`;
  return delta >= 0 ? `in ${span}` : `${span} ago`;
}

/**
 * Which window a round is in, from the clock.
 *
 * Derived, never stored. The contract keeps only `open`, `awarded` and
 * `declined`, because a phase that was written into storage would be wrong
 * from the second the window passed until someone paid gas to correct it.
 */
export function phaseOf(round: Round, now = Date.now()): Phase {
  if (round.status !== "open") return "settled";
  if (now <= new Date(round.commit_closes).getTime()) return "commit";
  if (now <= new Date(round.reveal_closes).getTime()) return "reveal";
  return "decide";
}

export const PHASE_LABEL: Record<Phase, string> = {
  commit: "COMMIT OPEN",
  reveal: "IN REVEAL",
  decide: "AWAITING DECISION",
  settled: "SETTLED",
};

export function statusLabel(round: Round, now = Date.now()): string {
  if (round.status === "awarded") return "AWARDED";
  if (round.status === "declined") return "DECLINED";
  return PHASE_LABEL[phaseOf(round, now)];
}

/** The next deadline that matters, and what it is. */
export function nextDeadline(
  round: Round,
  now = Date.now(),
): { label: string; at: string } | null {
  const phase = phaseOf(round, now);
  if (phase === "commit") return { label: "commit closes", at: round.commit_closes };
  if (phase === "reveal") return { label: "reveal closes", at: round.reveal_closes };
  if (phase === "decide") return { label: "decision closes", at: round.decide_closes };
  return null;
}

export function totalWeight(round: Round): number {
  return round.criteria.reduce((sum, c) => sum + c.weight, 0);
}

/** The highest total this round's criteria could produce, for the score bars. */
export function maxTotal(round: Round, scoreMax = 5): number {
  return totalWeight(round) * scoreMax;
}

export function scoredBids(bids: Bid[]): Bid[] {
  return bids
    .filter((b) => b.status === "scored")
    .sort((a, b) => (a.rank || 99) - (b.rank || 99));
}

/**
 * A refusal message with its classification prefix removed.
 *
 * The tags exist so validators know how to compare two errors; they are not
 * for people. The sentence after the tag was written to be read.
 */
export function humanError(message: string): string {
  return String(message || "")
    .replace(/^\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\]\s*/, "")
    .trim();
}
