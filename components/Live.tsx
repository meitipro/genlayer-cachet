"use client";

import { useEffect, useState } from "react";

import { countdown } from "@/lib/format";

/**
 * Deadlines that keep running after the page stopped being rendered.
 *
 * Every phase on this site is derived from a clock, and every page showing one
 * is a server component rendered at most once per `revalidate` window. So the
 * countdown a bidder reads was computed up to twenty seconds before it reached
 * them and then froze. On a sealed tender - where the entire mechanism is that
 * a window shuts at an instant nobody can move - a frozen countdown is the one
 * number on the page that must not be stale.
 *
 * Both components below render the server's own string on the first client
 * paint and only diverge afterwards, so hydration matches exactly rather than
 * being papered over with `suppressHydrationWarning`.
 */

/** Poll the wall clock, but only while the tab is actually being looked at. */
function useNow(active: boolean, everyMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    // A hidden tab is throttled to roughly once a minute anyway, and a bidder
    // is not reading it. Stopping outright and re-syncing on the way back is
    // both cheaper and more correct than trusting a throttled interval.
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), everyMs);
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, everyMs]);

  return now;
}

/**
 * A gap that ticks.
 *
 * `initial` is what the server rendered. It is shown verbatim until the first
 * effect runs, which is what makes the markup identical on both sides.
 *
 * Deliberately not an aria-live region: a value that changes every second would
 * make a screen reader read the page aloud once per second and drown out
 * everything else. The instant itself is always beside this in the markup, and
 * that is the part worth announcing.
 */
export function Countdown({
  at,
  initial,
  stopAfter = false,
}: {
  at: string;
  /** The server's rendering of this same gap, for the first paint. */
  initial: string;
  /** Freeze once the instant passes, instead of counting up forever. */
  stopAfter?: boolean;
}) {
  const target = new Date(at).getTime();
  const [passed, setPassed] = useState(false);
  const now = useNow(!(stopAfter && passed));

  useEffect(() => {
    if (now !== null && now >= target) setPassed(true);
  }, [now, target]);

  if (Number.isNaN(target)) return null;
  return <span className="tick">{now === null ? initial : countdown(at, now)}</span>;
}

/**
 * The bar that appears when a window shuts while the page is being read.
 *
 * `upcoming` is the set of instants that were still in the future when this
 * page was rendered. If the browser's clock crosses one of them, everything
 * below - the phase, the timeline, the button offering to seal a proposal -
 * describes a round that has moved on, and the honest thing is to say so
 * rather than to keep the stale screen looking live.
 *
 * It does not reload on its own. A page that reloads itself under someone who
 * is part-way through composing a proposal would destroy their work to fix a
 * cosmetic problem.
 */
export function StaleWatch({ upcoming }: { upcoming: string[] }) {
  const targets = upcoming
    .map((iso) => new Date(iso).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);

  const [crossed, setCrossed] = useState(false);
  const now = useNow(targets.length > 0 && !crossed);

  useEffect(() => {
    if (now !== null && targets.some((t) => now >= t)) setCrossed(true);
    // `targets` is rebuilt each render from an unchanging prop, so comparing
    // it by identity would re-run this on every tick. The first instant is
    // enough to identify the set for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, targets[0]]);

  if (!crossed) return null;

  return (
    <div className="banner banner-stale" role="alert">
      <div className="banner-inner">
        <b>A WINDOW CLOSED WHILE YOU WERE READING.</b>
        <span>
          The phase, the countdowns and the actions below were worked out when this page was
          built and no longer describe this round.{" "}
          <button type="button" className="link-btn" onClick={() => window.location.reload()}>
            Reload for the current state
          </button>
          .
        </span>
      </div>
    </div>
  );
}
