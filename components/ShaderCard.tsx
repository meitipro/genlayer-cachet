"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

/**
 * The shader library, fetched only when a card is about to run one.
 *
 * Imported statically it put 27 kB of WebGL into the docs page for every
 * reader, including the ones who never scroll as far as these cards and the
 * ones who asked for no motion and will never mount it at all. Split, the
 * page is back to its own weight and the chunk arrives with the first card
 * that needs it.
 *
 * `ssr: false` because a shader has nothing to prerender.
 */
const Warp = dynamic(() => import("@paper-design/shaders-react").then((m) => m.Warp), {
  ssr: false,
});

/**
 * A card whose ground is a live shader, in this product's palette.
 *
 * Adapted from a Tailwind reference implementation rather than pasted. Three
 * things had to change and each is a real constraint here, not a preference:
 *
 * 1. **The palette.** The reference cycles six saturated hues - hot pink,
 *    cyan, lime, orange. Cachet is wax red on bone and nothing else, and a
 *    green card in the middle of a tender would read as a status, not a
 *    decoration. Every card is graded from the same three wax tones and the
 *    variation between them is in movement and grain, not colour.
 * 2. **No Tailwind.** This repo styles with CSS tokens that carry the light
 *    and dark themes; the reference is utility classes with hardcoded
 *    `bg-black/80` and `text-white`. Hardcoding those here would have made
 *    the cards the one element on the site that ignores the theme.
 * 3. **Six live WebGL contexts is a real cost.** Browsers cap contexts per
 *    page and each one holds GPU memory and runs a fragment shader every
 *    frame. The shader mounts only while the card is on screen, and unmounts
 *    when it leaves.
 *
 * Under `prefers-reduced-motion` no shader mounts at all - the card keeps a
 * still gradient in the same colours. That is a stronger promise than pausing
 * an animation, and it also means the reader who asked for no motion never
 * pays for a WebGL context either.
 */

/** How far outside the viewport a card starts running, in pixels. */
const MARGIN = 200;

/** The three wax tones, in the order the shader layers them. */
const WAX = ["#2A1611", "#8C2818", "#C4472E", "#F0C3B6"];

export default function ShaderCard({
  title,
  body,
  index,
}: {
  title: string;
  body: string;
  /** Varies the motion so a grid of these does not pulse in lockstep. */
  index: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    // Asked for no motion: never mount a shader, and say so by simply not
    // setting `live`. The static gradient underneath is the finished state.
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches) return;

    // Decide from the geometry FIRST, then let the observer take over.
    //
    // An observer that never fires is not hypothetical: it happens wherever
    // the page is not being composited - a background tab, an embedded
    // webview, a headless harness - and it was the behaviour here. Waiting
    // only on the callback means a card that is plainly on screen silently
    // never gets its shader, which is a worse failure than one frame of
    // over-eager mounting.
    const onScreen = () => {
      const box = el.getBoundingClientRect();
      const h = window.innerHeight || document.documentElement.clientHeight;
      return box.top < h + MARGIN && box.bottom > -MARGIN;
    };
    setLive(onScreen());

    // No IntersectionObserver at all (old browser, jsdom): the measurement
    // above is the whole answer, and a missing capability should not cost the
    // reader the design.
    if (typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(([entry]) => setLive(entry.isIntersecting), {
      // A margin so the shader is already running by the time the card is
      // properly in view, rather than fading up under the reader's eye.
      rootMargin: `${MARGIN}px`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Enough variation to break the lockstep, small enough to stay one family.
  const speed = 0.28 + (index % 3) * 0.06;
  const swirl = 0.55 + (index % 4) * 0.08;
  const proportion = 0.32 + (index % 3) * 0.05;

  return (
    <div ref={host} className="shader-card">
      {/* The still ground. Always painted, so there is never a bare panel
          while the shader mounts, and it is the whole picture under reduced
          motion. */}
      <div className="shader-card-ground" aria-hidden="true" />

      {live ? (
        <div className="shader-card-canvas" aria-hidden="true">
          <Warp
            style={{ height: "100%", width: "100%" }}
            proportion={proportion}
            softness={1.1}
            distortion={0.14}
            swirl={swirl}
            swirlIterations={8}
            shape="checks"
            shapeScale={0.09}
            scale={1.15}
            rotation={index * 0.4}
            speed={speed}
            colors={WAX}
          />
        </div>
      ) : null}

      <div className="shader-card-body">
        <div className="shader-card-title">{title}</div>
        <p className="shader-card-text">{body}</p>
      </div>
    </div>
  );
}
