"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Intro from "./Intro";
import Landing from "./Landing";

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
 * "Launch dApp" goes to the docket. The handoff opens a dashboard overlay
 * there; the dashboard is the site's own shell in this build, so the button
 * navigates into it rather than drawing a second copy of it here.
 */
export default function Cinematic({
  network,
  live,
  openRounds,
}: {
  network: string;
  live: boolean;
  openRounds: number | null;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("cine");
    return () => document.documentElement.classList.remove("cine");
  }, []);

  // Prefetch the docket: the whole landing points at it, and the first click
  // should not be the first time the browser hears about that route.
  useEffect(() => {
    router.prefetch("/rounds");
  }, [router]);

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
      <Intro />
      <Landing
        network={network}
        live={live}
        openRounds={openRounds}
        menu={menu}
        setMenu={setMenu}
        onLaunch={() => router.push("/rounds")}
      />
    </main>
  );
}
