import type { Metadata } from "next";

import Cinematic from "@/components/cine/Cinematic";
import { CONFIGURED, getRounds } from "@/lib/cachet";
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
 * A server component: the one number the header shows - how many rounds are
 * taking bids - is read here and passed down, so it is a fact about the
 * contract rather than a figure typed into a design. When no contract is
 * configured, or the read did not land, the header says which of those it was
 * instead of naming a round that may not exist.
 */
export default async function Home() {
  const page = await getRounds(0, 24);
  const openRounds = page ? page.rounds.filter((r) => r.status === "open").length : null;

  return (
    <Cinematic
      network={NETWORK_LABEL}
      live={CONFIGURED && page !== null}
      openRounds={CONFIGURED ? openRounds : null}
    />
  );
}
