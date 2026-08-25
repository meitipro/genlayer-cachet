import { Suspense } from "react";
import type { Metadata } from "next";

import Cinematic from "@/components/cine/Cinematic";
import { CONFIGURED } from "@/lib/cachet";
import { NETWORK_LABEL } from "@/lib/chain";

export const revalidate = 30;

export const metadata: Metadata = {
  // `absolute` because the root layout's template appends " - Cachet", and
  // this title already ends in it: without this the tab reads
  // "Cachet - sealed proposal tendering - Cachet".
  title: { absolute: "Cachet - sealed proposal tendering" },
  description:
    "Your criteria get reinterpreted once the bids are in. Cachet freezes them on chain before anyone bids, so every award rests on a scorecard you can actually audit.",
};

/**
 * The landing.
 *
 * NOT async, and that is the point. This used to `await getRounds()` for the
 * one number the header shows - how many rounds are taking bids - which meant
 * the entire hero was suspended behind a contract read. Next rendered the
 * route's loading state while it waited, so opening the site showed a cream
 * panel reading "Reading the chain" and only then the dark hero and its seal
 * animation. The front door was a spinner.
 *
 * The count is now fetched by the header itself after paint, from
 * `/api/open-rounds`, where the read still happens on the server and still
 * shares the same cache and rate-limit budget. Nothing about the honesty
 * changes: it remains a fact read from the contract rather than a figure typed
 * into a design, and until it arrives the header says it is still reading
 * instead of naming a number.
 *
 * `CONFIGURED` stays here because it is a build-time constant - no read, no
 * wait - and it is the difference between "no contract is set" and "the read
 * did not land", which the header has to be able to tell apart.
 */
export default function Home() {
  return (
    /*
     * The boundary `useSearchParams` needs, now that this page is static.
     *
     * Its fallback is the landing's own ground and nothing else. A fallback
     * that rendered anything else would put a frame of some other page in
     * front of the hero, which is the whole problem this change exists to
     * remove - and the ground is what the hero paints on anyway, so the
     * handover is invisible.
     */
    <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#0B0907" }} />}>
      <Cinematic network={NETWORK_LABEL} configured={CONFIGURED} />
    </Suspense>
  );
}
