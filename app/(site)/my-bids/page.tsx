import type { Metadata } from "next";

import MyBids from "@/components/app/MyBids";

export const metadata: Metadata = {
  title: "My bids",
  // Noindex, because there is no version of this page a crawler can see. The
  // content is entirely a function of the connected address, so an indexed
  // copy would be the empty state and nothing else - a thin page ranking for
  // the site's own name. The sitemap leaves it out for the same reason and
  // robots.txt disallows it; this is the signal that survives someone linking
  // straight to it.
  robots: { index: false, follow: true },
};

/**
 * Thin on purpose: the whole pane depends on the connected address, which only
 * the browser knows, so the work is in the client component.
 */
export default function MyBidsPage() {
  return <MyBids />;
}
