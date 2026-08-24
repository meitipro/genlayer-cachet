import type { Metadata } from "next";
import localFont from "next/font/local";

import Cursor from "@/components/cine/Cursor";
import { ORIGIN } from "@/lib/chain";

import "./globals.css";
import "./cinematic.css";

/**
 * Both faces ship with the app, from `app/fonts`, and nothing is fetched at
 * build time or at run time.
 *
 * `next/font/google` looks equivalent and is not. It downloads each family
 * during the build, and when `fonts.googleapis.com` is unreachable it retries
 * three times and then carries on with a WARNING - so the build stays green
 * while the site quietly ships a system fallback. On a design that is almost
 * entirely typography, that is the worst possible failure: invisible in CI,
 * obvious to everyone who opens the page. It also means a build that only
 * succeeds with a warm cache, and a request to a third party on every view.
 *
 * These are the variable weight-axis faces, so one file covers the whole
 * range. `adjustFontFallback: false` because next/font has no metric override
 * table for a local face and warns on every build otherwise; the explicit
 * fallback list is what handles the swap instead.
 */
const sans = localFont({
  src: [
    { path: "./fonts/archivo-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/archivo-latin-wght-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-sans",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

const mono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-latin-wght-normal.woff2", weight: "100 800", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: {
    default: "Cachet - sealed proposal tendering",
    template: "%s - Cachet",
  },
  description:
    "Requests for proposals where the winning bid is chosen against criteria published before anyone bid. Criteria frozen on chain, bids sealed with a hash, and a full scorecard for every bidder.",
  applicationName: "Cachet",
  openGraph: {
    title: "Cachet - sealed proposal tendering",
    description:
      "Criteria frozen before the window opens, sealed bids, and a scorecard for every bidder rather than only the winner.",
    type: "website",
    siteName: "Cachet",
    // Generated once by scripts/og.py, in the site's own palette and typeface.
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Cachet - sealed proposal tendering" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cachet - sealed proposal tendering",
    description:
      "Criteria frozen before the window opens, sealed bids, and a scorecard for every bidder rather than only the winner.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/*
          The theme, decided BEFORE first paint.
          Set from React instead and the server markup carries no attribute, so
          a reader who chose light gets a frame of the dark palette before the
          effect runs. This runs synchronously in <head>, ahead of any paint,
          and defaults to dark because that is what the design is. Reading
          localStorage can throw outright when site data is blocked, hence the
          try - an unhandled error here would block the document.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('cachet:theme');" +
              "if(t!=='system'){document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}}" +
              "catch(e){document.documentElement.setAttribute('data-theme','dark')}",
          }}
        />
      </head>
      {/* No chrome here on purpose. The two route groups bring their own: the
          cinematic route is a fixed full-viewport app, and everything else
          keeps the rule bar, header and footer. */}
      <body>
        {/*
          Global, because the rule it replaces is global.
          cinematic.css carries the handoff's `cursor:none !important` under
          `(hover:hover) and (pointer:fine)`, which is every desktop mouse on
          every page. In the handoff that is safe: the whole design is one
          page, and the custom cursor is always mounted. Here it would have
          left the docket, the forms and the docs with no pointer at all.
        */}
        <Cursor />
        {children}
      </body>
    </html>
  );
}
