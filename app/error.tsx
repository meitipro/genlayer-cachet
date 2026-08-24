"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The error boundary for every route.
 *
 * Without one, a throw anywhere in a server component gives the reader Next's
 * default screen - a stack trace in development, a bare "Application error" in
 * production. Neither says what this site is or what to do next, and on a
 * product whose whole claim is that its record is legible, an unexplained
 * failure is the wrong last impression.
 *
 * Deliberately does NOT guess at a cause. Almost every failure here is the
 * network's rate limit, but saying so as a fact when it might be a genuine bug
 * would be the same mistake as answering 404 to a busy RPC.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on a production stack trace, so it is
    // logged rather than shown: it means nothing to a reader.
    console.error("[cachet] route error", error);
  }, [error]);

  return (
    <section className="section on-cream">
      <div className="shell">
        <div className="eyebrow-row">
          <div className="eyebrow">Something went wrong</div>
          <div className="eyebrow-note">this page did not finish loading</div>
        </div>
        <h1 className="display" style={{ maxWidth: "20ch" }}>
          This page could not be built.
        </h1>
        <p className="lede">
          Nothing on chain has changed, and nothing you did caused it. The most common reason is
          the network&rsquo;s rate limit, which allows 30 requests a minute and 500 an hour per
          address across everything on this machine - but this page cannot tell the difference
          between that and a genuine fault, so it is not going to guess.
        </p>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <Link href="/rounds" className="btn btn-ghost">
            Back to the docket
          </Link>
        </div>
        {error.digest ? (
          <p className="hash" style={{ marginTop: 22 }}>
            reference {error.digest}
          </p>
        ) : null}
      </div>
    </section>
  );
}
