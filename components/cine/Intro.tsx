"use client";

import { useEffect, useState } from "react";

/**
 * The wax seal being pressed, once, before the landing appears.
 *
 * Ported from the handoff's own keyframes, with two changes about not making a
 * first-time flourish into a permanent tax: it plays once per browser session
 * rather than once per navigation, and it is skipped under
 * `prefers-reduced-motion`.
 *
 * **It renders by default, and that is the whole point.** This component used
 * to start hidden and switch itself on in an effect, which put the animation
 * AFTER the first paint: the landing appeared, hydration ran, and only then did
 * the seal drop over the top of a page the reader had already started reading.
 * The old docstring claimed the decision was made "synchronously in the very
 * first render" - it was not, and the delay everybody could see was the proof.
 *
 * The decision now lives in the boot script in `app/layout.tsx`, which runs in
 * `<head>` before anything paints and stamps `data-intro="skip"` when the
 * animation should not play. `cinematic.css` hides the overlay on that
 * attribute, so a reader who asked for no motion never sees a frame of it and
 * somebody on their fourth page view never sees it either - while a first-time
 * visitor gets it as the first thing on screen, which is where it belongs.
 *
 * All this component does is take the finished overlay out of the tree.
 */
export default function Intro() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Already decided against in <head>; drop it immediately. It is display:none
    // by then, so nothing moves on screen.
    if (document.documentElement.getAttribute("data-intro") === "skip") {
      setDone(true);
      return;
    }
    // 2180ms delay + 620ms fade in the handoff's `lg-out`.
    const t = setTimeout(() => setDone(true), 2900);
    return () => clearTimeout(t);
  }, []);

  if (done) return null;

  return (
    <div
      aria-hidden="true"
      className="cine-intro"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 26,
        background: "radial-gradient(ellipse at 50% 46%,#1A100C 0%,#0B0907 62%)",
        animation: "lg-out 620ms cubic-bezier(.4,0,1,1) 2180ms forwards",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "clamp(110px,15vh,150px)",
          height: "clamp(110px,15vh,150px)",
          animation: "lg-press 1500ms cubic-bezier(.22,1,.36,1) 240ms both",
        }}
      >
        <div style={{ position: "absolute", inset: "-14%", border: "1px solid rgba(232,120,94,.5)", borderRadius: "50%", animation: "lg-shock 1000ms ease-out 700ms both" }} />
        <div style={{ position: "absolute", inset: "-14%", border: "1px solid rgba(232,120,94,.32)", borderRadius: "50%", animation: "lg-shock 1200ms ease-out 840ms both" }} />
        <svg
          viewBox="0 0 100 100"
          width="100%"
          height="100%"
          style={{
            position: "relative",
            display: "block",
            filter: "drop-shadow(0 12px 26px rgba(140,40,24,.55))",
            animation: "lg-in 900ms cubic-bezier(.22,1,.36,1) both",
          }}
        >
          <circle cx="50" cy="50" r="48" fill="none" stroke="#E8785E" strokeWidth="1.4" strokeDasharray="640" style={{ animation: "lg-draw 800ms cubic-bezier(.4,0,.2,1) 120ms both" }} />
          <circle cx="50" cy="50" r="48" fill="#A6321F" style={{ transformOrigin: "50% 50%", animation: "lg-in 700ms cubic-bezier(.34,1.4,.5,1) 420ms both" }} />
          <g style={{ transformOrigin: "50% 50%", animation: "lg-ring 1700ms cubic-bezier(.16,1,.3,1) 520ms both" }}>
            <circle cx="50" cy="50" r="37" fill="none" stroke="#F6EEDE" strokeWidth="1.6" strokeDasharray="2 3.6" />
          </g>
          <text
            x="50"
            y="53"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="var(--sans)"
            fontWeight="900"
            fontSize="44"
            fill="#F6EEDE"
            style={{ transformOrigin: "50% 50%", animation: "lg-c 620ms cubic-bezier(.22,1,.36,1) 640ms both" }}
          >
            C
          </text>
        </svg>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 11, animation: "lg-word 620ms cubic-bezier(.16,1,.3,1) 1020ms both" }}>
        <span style={{ fontSize: "clamp(21px,2.6vh,27px)", fontWeight: 600, letterSpacing: "-.6px", color: "#F1EAD9" }}>Cachet</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".3em", color: "#9A9080", whiteSpace: "nowrap" }}>
          SEALED TENDERING
        </span>
        <span
          style={{
            width: "clamp(120px,17vh,164px)",
            height: 1,
            background: "linear-gradient(90deg,transparent,#A6321F,transparent)",
            transformOrigin: "left center",
            animation: "lg-bar 900ms cubic-bezier(.22,1,.36,1) 1180ms both",
          }}
        />
      </div>
    </div>
  );
}
