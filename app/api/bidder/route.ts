import { NextResponse } from "next/server";

import { getBidder } from "@/lib/cachet";

/**
 * One address's bidding record, for the screens that only learn the address in
 * the browser.
 *
 * The chain reads live on the server because that is where the TTL cache and
 * the in-flight de-duplication live, and Studio allows about thirty requests a
 * minute across everything on the machine. A client that talked to the node
 * directly would bypass both and race the rest of the site for that budget.
 *
 * Read-only and takes nothing but an address, so there is no action here to
 * forge: it returns what any reader could already fetch from the contract.
 * The address is still validated rather than passed through, because an
 * unchecked value would become part of a cache key that anyone could grow.
 */
export const revalidate = 0;

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "not an address" }, { status: 400 });
  }

  const record = await getBidder(address);
  if (!record) {
    // "We could not ask" is not "this address has never bid", and the screen
    // has to be able to tell them apart.
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  return NextResponse.json(record);
}
