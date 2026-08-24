/**
 * The contract's compile-time limits, mirrored for the forms.
 *
 * These are facts about `contracts/cachet.py` - the same constants the
 * contract refuses on - not defaults invented for the UI. They exist so a form
 * can stop a caller before they spend gas on a value the contract was always
 * going to reject, and so `/publish` and `/bid` still work when the RPC is
 * unreachable.
 *
 * Keep them in step with the contract. Anything the OWNER can change at
 * runtime - the fee, the entry deposit, the appeal bond - is deliberately NOT
 * here: those are read from the chain, because a stale copy of a number that
 * decides what a bidder pays would be a lie.
 */
export const LIMITS = {
  scoreMax: 5,
  weightMin: 1,
  weightMax: 10,
  criteriaMin: 1,
  criteriaMax: 8,
  criterionTextMax: 160,
  titleMax: 120,
  summaryMax: 600,
  proposalMin: 40,
  proposalMax: 6000,
  argumentMin: 20,
  argumentMax: 600,
  bidsMax: 64,
  saltMin: 8,
  saltMax: 64,
  questionMin: 10,
  questionMax: 400,
  answerMax: 800,
  questionsMax: 32,
  asksPerAddress: 3,
} as const;
