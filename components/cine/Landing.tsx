"use client";

import Link from "next/link";

import { Mark } from "./Mark";

/**
 * The landing: video, header pill, hero, demo card.
 *
 * Ported from the handoff. The one substantive change is the network strip in
 * the header, which the design fills with "Live - Round 31 open". That number
 * is read from the contract here, and when there is no contract configured or
 * the read did not come back the strip says so rather than naming a round that
 * may not exist. A hardcoded round number on the landing page of a product
 * whose entire claim is auditability would be the worst possible place to
 * invent something.
 */
export default function Landing({
  network,
  configured,
  openRounds,
  menu,
  setMenu,
  onLaunch,
  onNavigate,
}: {
  network: string;
  /**
   * Whether an address is set for this network at all.
   *
   * Kept separate from whether the read landed. A single `live` flag folded the
   * two together, and the fold ran the wrong way: a configured contract behind a
   * rate limit rendered as "No contract configured", which is a claim about the
   * deployment rather than about the last second - and it made the "could not
   * read" line below unreachable, since a failed read always cleared the flag.
   */
  configured: boolean;
  /**
   * Rounds currently taking bids.
   *
   * Three values, because there are three things to say. `undefined` is
   * "still reading" - the hero paints before the count arrives now, so this
   * is the first frame's honest answer. `null` is "the chain did not answer".
   * A number is a number.
   */
  openRounds: number | null | undefined;
  menu: boolean;
  setMenu: (v: boolean) => void;
  onLaunch: () => void;
  /**
   * Where a header link should actually take the reader.
   *
   * The header does not navigate on its own any more: every destination in it
   * is behind the wallet step, so the decision belongs to the parent that knows
   * whether a wallet is connected.
   */
  onNavigate: (href: string) => void;
}) {
  const closeMenu = () => setMenu(false);

  /**
   * Intercept a plain left click, and only that.
   *
   * The links stay real `href`s so that middle click, ctrl/cmd click and "open
   * in new tab" keep working, and so the destination shows in the status bar.
   * Swallowing modified clicks too would quietly break every one of those.
   */
  const guard = (href: string) => (e: React.MouseEvent) => {
    closeMenu();
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(href);
  };

  const networkLine = !configured
    ? "No contract configured"
    : openRounds === undefined
      ? "Reading the chain"
      : openRounds === null
        ? "Could not read the chain"
        : openRounds === 0
          ? "Live - no round open"
          : `Live - ${openRounds} round${openRounds === 1 ? "" : "s"} open`;

  return (
    <section style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "100%", height: "100%", background: "#0B0907", overflow: "hidden" }}>
      <video
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        aria-hidden="true"
        // No poster: the section behind this already paints #0B0907, which is
        // the video's own darkest grade, so there is nothing to flash against.
        style={{
          position: "absolute",
          inset: 0,
          zIndex: -3,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
          pointerEvents: "none",
          userSelect: "none",
          filter: "saturate(.62) contrast(1.06) brightness(.72)",
        }}
      >
        {/* Self-hosted rather than the handoff's CDN URL: that bucket belongs
            to somebody else, and a hero that disappears when a third party
            tidies up is not a hero. */}
        <source src="/hero.mp4" type="video/mp4" />
      </video>

      {/* wax grade + vignette */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: -2,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse at 62% 46%,rgba(166,50,31,.30) 0%,rgba(166,50,31,.06) 44%,transparent 72%),linear-gradient(180deg,rgba(11,9,7,.42),rgba(11,9,7,.10) 26%,rgba(11,9,7,.34) 76%,rgba(11,9,7,.82)),linear-gradient(90deg,rgba(11,9,7,.72),transparent 52%),radial-gradient(ellipse at 44% 54%,transparent 30%,rgba(0,0,0,.42) 100%)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: -2,
          pointerEvents: "none",
          opacity: 0.05,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* ================= HEADER ================= */}
      <header
        id="hdr"
        style={{
          position: "absolute",
          top: "clamp(14px,2.1vh,22px)",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(1080px,calc(100vw - 2*clamp(20px,4vw,48px)))",
          height: 60,
          padding: "0 8px 0 20px",
          display: "flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          zIndex: 4,
          border: "1px solid rgba(241,234,217,.15)",
          borderRadius: 9999,
          background: "rgba(22,19,14,.6)",
          backdropFilter: "blur(14px) saturate(112%)",
          WebkitBackdropFilter: "blur(14px) saturate(112%)",
          boxShadow: "0 10px 34px rgba(0,0,0,.42)",
        }}
      >
        <Link href="/" aria-label="Cachet home" style={{ position: "relative", display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.4))", animation: "en-brand 580ms cubic-bezier(.16,1,.3,1) 60ms both" }}>
          <Mark size={25} />
        </Link>
        <span style={{ position: "relative", marginLeft: 9, fontWeight: 600, fontSize: 17, letterSpacing: "-.4px", color: "#F1EAD9", textShadow: "0 1px 3px rgba(0,0,0,.6)", animation: "en-brand 580ms cubic-bezier(.16,1,.3,1) 60ms both" }}>
          Cachet
        </span>

        <div id="navwrap" data-open={menu ? "1" : "0"} style={{ display: "flex", alignItems: "center", flex: 1, zIndex: 5 }}>
          <nav id="navlinks" aria-label="Primary" style={{ position: "relative", display: "flex", marginLeft: "clamp(36px,3.03vw,48px)", gap: "clamp(32px,2.9vw,43px)" }}>
            <Link href="/rounds" onClick={guard("/rounds")} style={navLink}>
              Docket
            </Link>
            <Link href="/publish" onClick={guard("/publish")} style={navLink}>
              Publish
            </Link>
            <Link href="/docs" onClick={guard("/docs")} style={navLink}>
              How it works
            </Link>
          </nav>

          <div
            id="tpanel"
            style={{
              marginLeft: "auto",
              width: 211,
              height: 48,
              paddingLeft: 8,
              borderLeft: "2px solid rgba(241,234,217,.52)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 3,
              animation: "en-nav 520ms cubic-bezier(.16,1,.3,1) 180ms both",
            }}
          >
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".14em", color: "rgba(244,240,232,.82)", textShadow: "0 1px 3px rgba(0,0,0,.6)" }}>
              {network.toUpperCase()}
            </span>
            <span style={{ fontSize: 15, fontWeight: 440, color: "rgba(255,255,255,.95)", textShadow: "0 1px 3px rgba(0,0,0,.6)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {networkLine}
            </span>
          </div>

          <button
            id="signup"
            type="button"
            onClick={onLaunch}
            style={{
              marginLeft: "clamp(20px,1.95vw,29px)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: 145,
              height: 42,
              border: "1px solid rgba(241,234,217,.16)",
              borderRadius: 7,
              background: "linear-gradient(145deg,#B93A24,#8C2818)",
              color: "#F6EEDE",
              fontFamily: "var(--sans)",
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: "-.34px",
              cursor: "pointer",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.18),0 1px 5px rgba(0,0,0,.4),0 0 22px rgba(166,50,31,.34)",
              animation: "en-action 520ms cubic-bezier(.16,1,.3,1) 220ms both",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F6C7BB", boxShadow: "0 0 8px rgba(246,199,187,.9)" }} />
            Launch dApp
          </button>
        </div>

        <button
          id="mtoggle"
          type="button"
          aria-label="Menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
          style={{
            display: "none",
            position: "relative",
            zIndex: 6,
            marginLeft: "auto",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            border: "1px solid rgba(241,234,217,.21)",
            borderRadius: 9999,
            background: "linear-gradient(145deg,rgba(30,22,18,.86),rgba(12,9,7,.9))",
            backdropFilter: "blur(14px) saturate(108%)",
            WebkitBackdropFilter: "blur(14px) saturate(108%)",
            color: "#F1EAD9",
            cursor: "pointer",
            boxShadow: "0 2px 10px rgba(0,0,0,.44)",
            animation: "en-action 520ms cubic-bezier(.16,1,.3,1) 140ms both",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            {menu ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 7h14M3 13h14" />}
          </svg>
        </button>
      </header>

      {/* ================= HERO ================= */}
      <div id="hero" style={{ position: "absolute", left: "clamp(36px,4.177vw,96px)", bottom: "clamp(34px,5.19vh,64px)", display: "flex", flexDirection: "column", alignItems: "flex-start", zIndex: 3 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--sans)",
            fontWeight: 500,
            fontSize: "clamp(58px,7.64vh,88px)",
            lineHeight: "clamp(72px,9.34vh,106px)",
            letterSpacing: "-2.1px",
            WebkitTextStroke: ".12px currentColor",
            whiteSpace: "nowrap",
            textShadow: "0 2px 2px rgba(0,0,0,.44)",
          }}
        >
          <span id="l1" style={{ display: "block", overflow: "hidden", transform: "scaleX(.775)", transformOrigin: "left center", color: "#FFFFFF" }}>
            <span style={{ display: "block", animation: "en-line 800ms cubic-bezier(.22,1,.36,1) 300ms both" }}>Stop Scoring</span>
          </span>
          <span id="l2" style={{ display: "block", overflow: "hidden", transform: "scaleX(.793)", transformOrigin: "left center", color: "rgba(219,209,196,.80)" }}>
            <span style={{ display: "block", animation: "en-line 850ms cubic-bezier(.22,1,.36,1) 440ms both" }}>Your Own Bids.</span>
          </span>
        </h1>

        <p
          id="copy"
          style={{
            position: "relative",
            left: 1,
            margin: "clamp(15px,2.08vh,24px) 0 0",
            width: "clamp(390px,31.67vw,500px)",
            fontSize: "clamp(14px,1.70vh,19px)",
            lineHeight: "clamp(19px,2.17vh,24px)",
            fontWeight: 350,
            letterSpacing: ".13px",
            color: "rgba(233,229,222,.88)",
            textShadow: "0 1px 3px rgba(0,0,0,.7)",
            animation: "en-copy 620ms cubic-bezier(.16,1,.3,1) 740ms both",
          }}
        >
          Your criteria get reinterpreted once the bids are in.
          <br />
          Cachet freezes them on chain before anyone bids, so every
          <br />
          award rests on a scorecard you can actually audit.
        </p>

        <Link
          href="/publish"
          style={{
            marginTop: "clamp(24px,3.11vh,36px)",
            display: "inline-flex",
            alignItems: "center",
            gap: "clamp(10px,1.3vh,15px)",
            height: "clamp(38px,3.96vh,44px)",
            padding: "0 5px 0 clamp(14px,1.6vh,18px)",
            border: "none",
            borderRadius: 7,
            background: "#F1EAD9",
            color: "#16130E",
            fontFamily: "var(--sans)",
            fontSize: "clamp(16px,1.77vh,19.25px)",
            fontWeight: 450,
            letterSpacing: "-.3px",
            whiteSpace: "nowrap",
            cursor: "pointer",
            boxShadow: "0 1px 5px rgba(0,0,0,.38)",
            animation: "en-action 560ms cubic-bezier(.16,1,.3,1) 960ms both",
          }}
        >
          Publish Tender
          <span style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", width: "clamp(30px,3.1vh,35px)", height: "clamp(28px,2.85vh,32px)", borderRadius: 6, background: "#A6321F" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F6EEDE" strokeWidth="2.1" aria-hidden="true">
              <path d="M5 12h13M12.5 6l6 6-6 6" />
            </svg>
          </span>
        </Link>
      </div>

      {/* ================= DEMO CARD ================= */}
      <article
        id="card"
        style={{
          position: "absolute",
          right: "clamp(36px,4.04vw,96px)",
          bottom: "clamp(34px,5.19vh,64px)",
          width: "clamp(150px,18.96vh,215px)",
          aspectRatio: "201 / 265",
          containerType: "inline-size",
          zIndex: 3,
          border: "1px solid rgba(241,234,217,.14)",
          borderRadius: "clamp(12px,1.52vh,18px)",
          background: "linear-gradient(145deg,rgba(30,22,18,.82),rgba(10,7,6,.88))",
          boxShadow: "0 2px 10px rgba(0,0,0,.44),0 0 0 3px rgba(241,234,217,.035) inset,0 0 0 1px rgba(0,0,0,.9)",
          backdropFilter: "blur(14px) saturate(108%)",
          WebkitBackdropFilter: "blur(14px) saturate(108%)",
          animation: "en-card 920ms cubic-bezier(.22,1,.36,1) 1040ms both",
          transformOrigin: "82% 50%",
        }}
      >
        <div style={{ position: "absolute", left: "3.5cqw", top: "4cqw", width: "92.5cqw", height: "92cqw", borderRadius: "4cqw", overflow: "hidden", background: "#1A0E0A" }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 32% 30%,rgba(232,120,94,.85) 0%,rgba(166,50,31,.62) 26%,transparent 58%),radial-gradient(circle at 72% 74%,rgba(120,38,24,.9) 0%,rgba(58,20,14,.7) 34%,transparent 66%),linear-gradient(150deg,#2A1410,#0D0706)",
              filter: "brightness(.92) saturate(.96) contrast(1.03)",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.16,
              mixBlendMode: "overlay",
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23s)'/%3E%3C/svg%3E\")",
            }}
          />
          <button
            type="button"
            onClick={onLaunch}
            aria-label="Open the dApp"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%,-50%)",
              width: "29cqw",
              height: "29cqw",
              border: "1px solid rgba(241,234,217,.36)",
              borderRadius: "50%",
              background: "rgba(3,5,7,.47)",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <svg width="42%" height="42%" viewBox="0 0 12 14" fill="#F6EEDE" aria-hidden="true">
              <path d="M1 1l10 6-10 6z" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={onLaunch}
          style={{
            position: "absolute",
            left: "3.5cqw",
            right: "3.5cqw",
            bottom: "4cqw",
            height: "16.5cqw",
            border: "1px solid rgba(241,234,217,.22)",
            borderRadius: "4cqw",
            background: "linear-gradient(145deg,rgba(44,26,20,.86),rgba(24,14,11,.9))",
            color: "#F1EAD9",
            fontFamily: "var(--sans)",
            fontSize: "7.4cqw",
            fontWeight: 430,
            letterSpacing: "-.2px",
            cursor: "pointer",
          }}
        >
          Open the dApp
        </button>
      </article>
    </section>
  );
}

const navLink: React.CSSProperties = {
  position: "relative",
  fontSize: 16,
  fontWeight: 430,
  letterSpacing: "-.36px",
  color: "rgba(233,228,216,.80)",
  textShadow: "0 1px 3px rgba(0,0,0,.55)",
};
