/**
 * The shapes the contract's views return.
 *
 * Every view in contracts/cachet.py returns a JSON string, because calldata
 * carries None|int|str|bytes|list|dict[str, ...] and a JSON string crosses that
 * boundary without the shape of a dataclass having to survive it. These types
 * are the other half of that contract; they are hand-kept in step with
 * `_round_shape` and `_bid_shape`, which are the only two places the contract
 * builds a record for a reader.
 *
 * Amounts that are wei arrive as decimal STRINGS. A budget of 40,000 GEN is
 * 4e22 wei, which is past Number.MAX_SAFE_INTEGER - parsing one as a number
 * loses the low digits silently, and the number it loses them from is the one
 * on the award screen.
 */

export type RoundStatus = "open" | "awarded" | "declined";
export type BidStatus = "sealed" | "revealed" | "scored" | "expired" | "withdrawn";
export type AppealStatus = "" | "open" | "upheld" | "rejected" | "abandoned";

/** Derived from the clock, not stored. */
export type Phase = "commit" | "reveal" | "decide" | "settled";

export interface Criterion {
  i: number;
  text: string;
  weight: number;
  primary: boolean;
}

export interface Round {
  id: number;
  buyer: string;
  title: string;
  summary: string;
  criteria: Criterion[];
  budget: string;
  entry_deposit: string;
  appeal_bond: string;
  fee_bps: number;
  commit_closes: string;
  reveal_closes: string;
  decide_closes: string;
  eligibility: string;
  primary_index: number;
  max_bids: number;
  criteria_hash: string;
  status: RoundStatus;
  awarded_to: string;
  awarded_total: number;
  decline_reason: string;
  published_at: string;
  settled_at: string;
  forfeited: string;
  /** Bids in play. A withdrawn row is kept for stable indices but not counted. */
  bids: number;
  /** Underlying rows, withdrawals included. Only useful next to `bids`. */
  rows: number;
  sealed: number;
  revealed: number;
  scored: number;
  expired: number;
  withdrawn: number;
  appeals_open: number;
  /** Public clarifications asked on this round, and how many await an answer. */
  questions: number;
  questions_unanswered: number;
}

/**
 * One public clarification.
 *
 * An answer explains what a frozen criterion MEANS. It never changes what is
 * scored - the model is given the criteria and nothing else - which is a limit
 * worth stating wherever these are shown.
 */
export interface Question {
  i: number;
  asker: string;
  text: string;
  /** Empty until the buyer answers. Answered once, then fixed. */
  answer: string;
  asked_at: string;
  answered_at: string;
}

export interface Bid {
  i: number;
  bidder: string;
  commitment: string;
  status: BidStatus;
  scores: number[];
  reasons: string[];
  total: number;
  /** 1-based among scored bids; 0 when this bid has no score. */
  rank: number;
  deposit: string;
  owed: string;
  committed_at: string;
  revealed_at: string;
  scored_at: string;
  appeal_status: AppealStatus;
  appeal_argument: string;
  appeal_total_before: number;
  rescored: boolean;
  /** Times the bidder replaced this digest while the commit window was open. */
  amendments: number;
  amended_at: string;
  withdrawn_at: string;
  proposal: string;
  proposal_length: number;
}

export interface Stats {
  rounds: number;
  awarded: number;
  declined: number;
  escrowed: string;
  paid: string;
  fees: string;
  bids_sealed: number;
  bids_scored: number;
  appeals: number;
  appeals_upheld: number;
}

export interface Terms {
  /** Which revision of contracts/cachet.py this deployment is running. */
  version: string;
  owner: string;
  treasury: string;
  fee_bps: number;
  entry_deposit: string;
  appeal_bond: string;
  score_max: number;
  weight_max: number;
  criteria_max: number;
  proposal_max: number;
  bids_max: number;
}

export interface CriteriaCheck {
  found: boolean;
  scorable?: boolean;
  /** Indices of the criteria the network refused. */
  flagged?: number[];
  reasons?: string[];
  criteria?: string[];
  checked_at?: string;
  checked_by?: string;
}

export interface BuyerRecord {
  found: boolean;
  address: string;
  run: number;
  awarded: number;
  declined: number;
  open: number;
  bids: number;
  escrowed: string;
  /** Only the newest page. The counters above describe the whole history. */
  rounds: Round[];
  showing: number;
}

/** Everything a round page needs, read together so the two cannot disagree. */
export interface RoundView {
  round: Round;
  /**
   * NULL means the bids could not be read, and is not the same as an empty
   * array. Collapsing the two is the one mistake this codebase exists to
   * avoid: it turns "we could not ask" into "there were none", which on a
   * round page reads as a tender nobody bid on, and on a bid page as a bid
   * that does not exist.
   */
  bids: Bid[] | null;
}

/**
 * A bidder's record: the mirror of `BuyerRecord`.
 *
 * `expired` and `withdrawn` are separate on purpose. Both end a bid without a
 * score, but one is a commitment abandoned after a buyer began waiting on it
 * and the other is a decision taken in the open while the window was still
 * filling. Merging them would hide the only distinction a reader cares about.
 *
 * `points` over `points_max` rather than a percentage: rounds carry different
 * criteria and weights, so the ratio is the only figure that compares across
 * them, and it is rounded once here at the edge.
 */
export interface BidderRecord {
  found: boolean;
  address: string;
  /** Rounds this address has entered at least once. */
  entered: number;
  /** Commitments made, cumulative: revealed + expired + withdrawn + sealed. */
  made: number;
  revealed: number;
  scored: number;
  expired: number;
  withdrawn: number;
  sealed: number;
  won: number;
  /** Payout won, in wei, net of the fee. */
  won_value: string;
  points: number;
  points_max: number;
  /** Newest page only; the counters above describe the whole history. */
  rounds: (Round & { mine: BidderRow | null })[];
  showing: number;
}

export interface BidderRow {
  i: number;
  status: BidStatus;
  total: number;
  max_total: number;
  rescored: boolean;
  appeal_status: AppealStatus;
  amendments: number;
  won: boolean;
}
