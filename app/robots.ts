import type { MetadataRoute } from "next";

import { ORIGIN } from "@/lib/chain";

/**
 * Crawlers are welcome on the readable record and nowhere else.
 *
 * `/bid/` is disallowed on purpose. It is a working screen, not a document:
 * everything worth indexing about a round lives on `/r/[id]`, and a crawler
 * walking every bid form is spending this site's rate-limit budget - 30
 * requests a minute, 500 an hour, shared across every visitor - on pages that
 * were never meant to be read by anyone but the bidder.
 *
 * `/my-bids` and `/api/` join it for the same reason from the other side: both
 * are a function of who is asking. `/my-bids` is empty without a wallet, and
 * the API routes exist to serve those screens rather than to be read. Neither
 * has a crawlable version, so the budget spent fetching them buys nothing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/bid/", "/my-bids", "/api/"] }],
    sitemap: `${ORIGIN}/sitemap.xml`,
    host: ORIGIN,
  };
}
