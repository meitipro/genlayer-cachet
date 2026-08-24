"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The handoff's two-part cursor: a solid dot and a ring that lags behind it.
 *
 * Driven from a rAF loop writing `transform` directly on the nodes rather than
 * through React state. At 60fps a state update per frame would re-render the
 * whole page around this, and the design's own CSS already hides both elements
 * on coarse pointers.
 *
 * The `hot` state is set from a delegated pointerover rather than a listener
 * per element, because the dashboard swaps its whole main pane between views
 * and any per-element binding would need rebinding on every one of them.
 */
export default function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState(false);
  const [down, setDown] = useState(false);

  useEffect(() => {
    // Nothing to draw where there is no fine pointer, and the CSS hides these
    // anyway - but the rAF loop is worth not starting at all on a phone.
    if (!window.matchMedia("(hover:hover) and (pointer:fine)").matches) return;

    const d = dot.current;
    const r = ring.current;
    if (!d || !r) return;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let rx = x;
    let ry = y;
    let raf = 0;
    let seen = false;

    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!seen) {
        seen = true;
        rx = x;
        ry = y;
        d.style.opacity = "1";
        r.style.opacity = "1";
      }
      const el = e.target as Element | null;
      setHot(Boolean(el?.closest?.("a,button,input,textarea,select,[role='button']")));
    };

    const tick = () => {
      // The ring eases toward the dot; the dot is exact. That gap is the whole
      // effect, so it is a lerp rather than both being pinned to the pointer.
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      d.style.transform = `translate3d(${x}px,${y}px,0)`;
      r.style.transform = `translate3d(${rx}px,${ry}px,0)`;
      raf = requestAnimationFrame(tick);
    };

    const onDown = () => setDown(true);
    const onUp = () => setDown(false);
    const onLeave = () => {
      d.style.opacity = "0";
      r.style.opacity = "0";
      seen = false;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <>
      <div id="curRing" ref={ring} data-hot={hot ? "1" : "0"} data-down={down ? "1" : "0"} aria-hidden="true" />
      <div id="cur" ref={dot} aria-hidden="true" />
    </>
  );
}
