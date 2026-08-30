import type { MetadataRoute } from "next";

import { getRounds } from "@/lib/cachet";
import { ORIGIN } from "@/lib/chain";

/**
 * The static pages, plus whatever rounds the contract will tell us about.
 *
 * Two deliberate limits.
 *
 * ONE PAGE OF ROUNDS, not all of them. A sitemap that walked the whole archive
 * would cost one contract read per page of 24 on every crawl, out of the same
 * 500-an-hour budget the site itself needs. The newest rounds are the ones
 * worth discovering; older ones are still reachable from `/rounds`.
 *
 * AND IT NEVER FAILS THE BUILD. If the chain cannot be read, this returns the
 * static routes alone rather than throwing - a sitemap is a hint to a crawler,
 * and no hint is worth a broken deploy.
 *
 * Two of the app's own panes are left out on purpose rather than by oversight.
 * `/exhibit` is a redirect to whichever round was awarded last, and a redirect
 * listed in a sitemap is reported back as an indexing error rather than
 * followed. `/my-bids` renders nothing without a connected wallet, so a
 * crawler would only ever see the empty shell - it is marked noindex at the
 * page instead.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${ORIGIN}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${ORIGIN}/rounds`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${ORIGIN}/app`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: `${ORIGIN}/publish`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${ORIGIN}/how`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${ORIGIN}/docs`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${ORIGIN}/contract`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${ORIGIN}/scorecards`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${ORIGIN}/treasury`, lastModified: now, changeFrequency: "daily", priority: 0.5 },
  ];

  let rounds: MetadataRoute.Sitemap = [];
  try {
    const page = await getRounds(0, 24);
    rounds = (page?.rounds ?? []).map((r) => ({
      url: `${ORIGIN}/r/${r.id}`,
      // A settled round never changes again; an open one changes constantly.
      lastModified: r.settled_at ? new Date(r.settled_at) : now,
      changeFrequency: r.status === "open" ? ("hourly" as const) : ("yearly" as const),
      priority: r.status === "open" ? 0.8 : 0.6,
    }));
  } catch {
    // Reading the chain is optional here, by design. See above.
  }

  return [...staticRoutes, ...rounds];
}
