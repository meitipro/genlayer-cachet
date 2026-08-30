import Link from "next/link";

import { CACHET, IS_LIVE, explorerAddress, HAS_EXPLORER } from "@/lib/chain";

/** The wax seal, flat. Used at every size the 3D version is not worth loading at. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="46" fill="#A6321F" />
      <circle
        cx="50"
        cy="50"
        r="36"
        fill="none"
        stroke="#F6EEDE"
        strokeWidth="1.4"
        strokeDasharray="2 3.6"
        opacity=".75"
      />
      <text
        x="50"
        y="53"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-sans), sans-serif"
        fontWeight="900"
        fontSize="42"
        fill="#F6EEDE"
      >
        C
      </text>
    </svg>
  );
}


export function Footer() {
  return (
    <footer className="footer">
      <div className="shell">
        <div className="footer-grid">
          <div className="footer-col">
            <div className="row" style={{ marginBottom: 18 }}>
              <Mark size={26} />
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 18,
                  color: "var(--on-ink)",
                  letterSpacing: "-.02em",
                }}
              >
                Cachet
              </span>
            </div>
            <p style={{ fontSize: 13.5, lineHeight: 1.5, maxWidth: "30ch" }}>
              Sealed proposal tendering, scored against criteria published before anyone bid.
            </p>
          </div>

          <div className="footer-col">
            <div className="label" style={{ marginBottom: 18 }}>
              Product
            </div>
            <ul>
              <li>
                <Link href="/rounds">The docket</Link>
              </li>
              <li>
                <Link href="/exhibit">A finished round</Link>
              </li>
              <li>
                <Link href="/publish">Publish a tender</Link>
              </li>
              <li>
                <Link href="/docs">How it works</Link>
              </li>
            </ul>
          </div>

          <div className="footer-col">
            {/*
              Named for what the column holds rather than for what the product
              lacks. Every link below explains a mechanism - where the score
              stops, how an appeal runs, how agreement is reached - and a
              heading that framed them as an apology sold each one short.
            */}
            <div className="label" style={{ marginBottom: 18 }}>
              How the mark is made
            </div>
            <ul>
              <li>
                <Link href="/docs#cannot">Where the score stops</Link>
              </li>
              <li>
                <Link href="/docs#appeal">The appeal path</Link>
              </li>
              <li>
                <Link href="/docs#questions">Asking what a criterion means</Link>
              </li>
              <li>
                <Link href="/docs#scoring">How scoring agrees</Link>
              </li>
              <li>
                <Link href="/docs#studio">What Studio establishes</Link>
              </li>
            </ul>
          </div>

          <div className="footer-col">
            <div className="label" style={{ marginBottom: 18 }}>
              Contract
            </div>
            {IS_LIVE ? (
              <p className="hash" style={{ color: "var(--on-ink-dim)", marginBottom: 12 }}>
                {HAS_EXPLORER ? (
                  <a href={explorerAddress(CACHET)} target="_blank" rel="noreferrer noopener">
                    {CACHET}
                  </a>
                ) : (
                  CACHET
                )}
              </p>
            ) : (
              <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
                No contract is configured for this network, so there is nothing to read. Nothing
                on this site is invented to fill that gap.
              </p>
            )}
            <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--on-ink-faint)" }}>
              Built on GenLayer Studio. Studio is gasless, so nothing here measures what a round
              costs on a live network.
            </p>
          </div>
        </div>

        <div className="footer-bar">
          <span>© 2026 CACHET</span>
          <span>GENLAYER BUILD BRIEF - SERIES TWO - PROJECT 11 OF 20</span>
        </div>
      </div>
    </footer>
  );
}

/**
 * Shown when no contract address is configured for this network.
 *
 * There is no sample data behind this - the site has nothing to show and says
 * so. On a product whose whole claim is that the scoring is verifiable, a
 * fabricated round rendering exactly like a real one would be the worst thing
 * the codebase could contain.
 */
export function NotConfigured() {
  return (
    <div className="banner">
      <div className="banner-inner">
        <b>NO CONTRACT CONFIGURED.</b>
        <span>
          Set <code className="mono">NEXT_PUBLIC_CACHET_ADDRESS</code> to a contract deployed on{" "}
          this network and rebuild. Until then there is nothing to read, and nothing here is
          invented to fill the gap.
        </span>
      </div>
    </div>
  );
}

/** Shown when the contract is configured but the read did not come back. */
export function Unreachable({ what = "this page" }: { what?: string }) {
  return (
    <div className="banner">
      <div className="banner-inner">
        <b>COULD NOT REACH THE CONTRACT.</b>
        <span>
          The data for {what} was not read. This is usually the network&rsquo;s rate limit - it
          allows 30 requests a minute and 500 an hour per address, shared across everything on
          this machine. Wait a moment and reload.
        </span>
      </div>
    </div>
  );
}
