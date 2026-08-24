"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import Intro from "./Intro";
import Landing from "./Landing";

/**
 * Loaded on demand, and measurably worth it.
 *
 * `Connect` reaches the chain config and the wallet helpers, which pull
 * genlayer-js in behind them. Imported statically it landed in the landing
 * page's own bundle and took its First Load JS from 101 kB to 215 kB - the
 * whole SDK downloaded by every visitor reading the hero, most of whom never
 * press the button. Split here it arrives on the click that needs it.
 *
 * `ssr: false` because there is nothing to prerender: the screen's entire job
 * is to talk to a browser extension.
 */
const Connect = dynamic(() => import("./Connect"), {
  ssr: false,
  // A click has to do something immediately. Without this the button would sit
  // there looking unpressed for as long as the chunk takes, which on a slow
  // connection is exactly when a second click is most likely. Painting the
  // screen's own ground means the real panel fades in over it rather than
  // replacing a flash of something else.
  loading: () => (
    <div
      style={{ position: "absolute", inset: 0, background: "#0B0907" }}
      role="status"
      aria-label="Opening the wallet step"
    />
  ),
});

/**
 * The landing experience: intro, header, hero, demo card.
 *
 * This is the one route that takes over the viewport, so it is also the one
 * route that adds `.cine` to the root element. That class carries the overflow
 * lock from the handoff's stylesheet, and it is removed on unmount rather than
 * left behind - a lock that outlived this page would trap the docs and the
 * docket at one viewport height with no way to scroll, which is the kind of
 * bug that only appears after a soft navigation and never in a reload.
 *
 * "Launch dApp" opens the wallet step, which is where the handoff puts it. An
 * earlier version of this file sent the button straight to the docket on the
 * reasoning that the dashboard is the site's own shell here - but the wallet
 * screen is not the dashboard, it is the step before it, and dropping it took
 * out the only place the app asks which address you are bidding as.
 */
export default function Cinematic({
  network,
  configured,
  openRounds,
}: {
  network: string;
  configured: boolean;
  openRounds: number | null;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  /**
   * Which of the two full-screen views is showing.
   *
   * State rather than a route, matching the handoff: the connect step is a
   * moment inside the landing, and giving it a URL of its own would make it
   * something a reader could land on cold, bookmark, or be sent back to by the
   * back button after they had already connected.
   */
  const [view, setView] = useState<"landing" | "connect">("landing");

  useEffect(() => {
    document.documentElement.classList.add("cine");
    return () => document.documentElement.classList.remove("cine");
  }, []);

  // Prefetch the docket: the whole landing points at it, and the first click
  // should not be the first time the browser hears about that route.
  useEffect(() => {
    router.prefetch("/rounds");
  }, [router]);

  // Escape backs out of the connect step. It is a dialog in everything but
  // markup, and it should close the way one does.
  useEffect(() => {
    if (view !== "connect") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setView("landing");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  // Escape closes the mobile menu. A panel that can be opened from the
  // keyboard has to be closable from it too.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <main style={{ position: "fixed", inset: 0, isolation: "isolate", background: "#0B0907" }}>
      {view === "landing" ? (
        <>
          <Intro />
          <Landing
            network={network}
            configured={configured}
            openRounds={openRounds}
            menu={menu}
            setMenu={setMenu}
            onLaunch={() => {
              setMenu(false);
              setView("connect");
            }}
          />
        </>
      ) : (
        <Connect network={network} onBack={() => setView("landing")} />
      )}
    </main>
  );
}
