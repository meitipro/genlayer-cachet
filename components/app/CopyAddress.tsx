"use client";

import { useCallback, useState } from "react";

/**
 * Copy, and say plainly when the browser refused.
 *
 * `navigator.clipboard` throws outright where the page is not trusted or the
 * permission is denied. Showing a tick regardless would be the control lying
 * about the one thing it does.
 */
export default function CopyAddress({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "done" | "blocked">("idle");

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
      setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("blocked");
    }
  }, [value]);

  return (
    <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy()}>
      {state === "done" ? "Copied" : state === "blocked" ? "Copy was blocked" : "Copy address"}
    </button>
  );
}
