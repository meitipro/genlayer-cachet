import { NextResponse } from "next/server";

import { CONFIGURED, getRounds } from "@/lib/cachet";

/**
 * How many rounds are taking bids, for the landing's header line.
 *
 * A route rather than a read inside the page, because the page must not wait
 * for it. See `app/(cine)/page.tsx` - blocking the hero on a chain read put a
 * loading panel in front of the site every time somebody opened it.
 *
 * The read still happens on the server, where the TTL cache and the in-flight
 * de-duplication live, so this costs the same one request the page used to and
 * shares it with every other reader in the window.
 */
export const revalidate = 15;

export async function GET() {
  if (!CONFIGURED) return NextResponse.json({ configured: false, open: null });

  const page = await getRounds(0, 24);
  if (!page) {
    // Could not ask. Distinct from "no round is open", and the header says so.
    return NextResponse.json({ configured: true, open: null });
  }
  return NextResponse.json({
    configured: true,
    open: page.rounds.filter((r) => r.status === "open").length,
  });
}
