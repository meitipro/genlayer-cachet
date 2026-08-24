"use client";

import { useEffect } from "react";

/**
 * Keeps the resolved palette honest on every route, for the whole session.
 *
 * Three separate things decide what the page looks like, and each needs its own
 * moment:
 *
 * 1. FIRST PAINT is the boot script in `app/layout.tsx`. It has to be inline
 *    and synchronous, because a component cannot run before the first frame and
 *    a flash of the wrong palette is the one thing a theme must never do.
 * 2. A TOGGLE is `AppShell`, which owns the control and writes the choice.
 * 3. A CHANGE THAT COMES FROM OUTSIDE THE PAGE is this component.
 *
 * The third case used to be handled inside `AppShell` too, which meant it only
 * worked on the dashboard: with the choice set to "system", turning the OS from
 * light to dark while reading `/docs`, a round page or the landing did nothing
 * at all until a reload. "System" that only follows the system on one route is
 * not really following it. This mounts in the root layout, so every route does.
 *
 * It also picks up the `storage` event, which fires in the OTHER tabs when one
 * tab writes. Two tabs open on the same site disagreeing about the theme is a
 * small thing, but it is the sort of small thing that reads as a bug.
 *
 * Renders nothing. It only ever sets one attribute, and never removes it -
 * `globals.css` defines light and dark explicitly, so an absent attribute would
 * silently mean light.
 */
export default function ThemeSync() {
  useEffect(() => {
    const root = document.documentElement;
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)");

    // Read the choice at event time rather than closing over it. The toggle
    // lives in another component and writes straight to storage, so anything
    // captured at mount would be stale the moment somebody used it.
    const apply = () => {
      let choice: string | null = null;
      try {
        choice = window.localStorage.getItem("cachet:theme");
      } catch {
        /* storage blocked: fall through to the OS preference */
      }
      const resolved =
        choice === "light" || choice === "dark"
          ? choice
          : prefersLight.matches
            ? "light"
            : "dark";
      if (root.getAttribute("data-theme") !== resolved) {
        root.setAttribute("data-theme", resolved);
      }
    };

    prefersLight.addEventListener("change", apply);
    window.addEventListener("storage", apply);
    return () => {
      prefersLight.removeEventListener("change", apply);
      window.removeEventListener("storage", apply);
    };
  }, []);

  return null;
}
