import type { Metadata } from "next";

import MyBids from "@/components/app/MyBids";

export const metadata: Metadata = { title: "My bids" };

/**
 * Thin on purpose: the whole pane depends on the connected address, which only
 * the browser knows, so the work is in the client component.
 */
export default function MyBidsPage() {
  return <MyBids />;
}
