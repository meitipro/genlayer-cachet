import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getRounds } from "@/lib/cachet";

export const revalidate = 30;

export const metadata: Metadata = {
  title: "A finished round",
  description:
    "The most recently awarded tender, with every bidder's scorecard beside the winner's.",
};

/**
 * "Show me a finished round", resolved rather than guessed.
 *
 * The header and footer used to link straight to `/r/0`. On the contract this
 * was built against, round 0 happened to exist; on a contract somebody deploys
 * today it does not, so the primary navigation of a freshly deployed site
 * pointed at a 404. A nav item is a promise, and this one was only true by
 * coincidence.
 *
 * The rule is the same one the home page uses: the most recently AWARDED
 * round. A declined round has no scorecards, and the scorecards are the only
 * thing here that proves anything.
 *
 * When there is no such round - nothing configured, nothing readable, or
 * nothing awarded yet - this falls through to the docket, which already
 * explains each of those three cases in its own words rather than pretending
 * the exhibit is merely missing.
 */
export default async function Exhibit() {
  const page = await getRounds(0, 12);
  const awarded = page?.rounds.find((r) => r.status === "awarded");
  redirect(awarded ? `/r/${awarded.id}` : "/rounds");
}
