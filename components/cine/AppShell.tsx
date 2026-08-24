"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Mark } from "./Mark";
import { useWallet } from "@/components/wallet";
import { shortAddress } from "@/lib/format";

/**
 * The dashboard shell from the handoff: topbar, collapsible rail, main pane.
 *
 * The design draws this as an overlay over the landing with six views switched
 * by client state. Here the views are the site's own routes, so the rail is
 * real navigation: every item is a link with an href, the browser's back
 * button works, and a shared link opens the same screen the rail does. The
 * alternative - six client-side views behind one URL - would have meant a
 * product about auditable records where nothing in it could be linked to.
 *
 * Every count in the rail comes from the contract. The handoff has "3" and "4"
 * printed beside Docket and My bids; those are placeholders, and a number
 * beside a nav item that nobody read from anywhere is exactly the kind of
 * decoration this project refuses.
 */
type Counts = { rounds: number | null; open: number | null };

export default function AppShell({
  children,
  network,
  counts,
}: {
  children: React.ReactNode;
  network: string;
  counts: Counts;
}) {
  const pathname = usePathname();
  const { address, connect, busy } = useWallet();
  /*
   * The same first frame on the server and on the client, deliberately.
   *
   * Reading localStorage in the initial state looks like the tidy fix for the
   * flash, and it is a hydration mismatch: the server has no storage and
   * renders "dark", the client reads "light" and renders that, and React does
   * not repair the attributes it has already shipped. The switcher then
   * highlighted Dark on a light page, and clicking Light was a NO-OP, because
   * the state already said "light" and React bailed out of the render. The
   * only escape was to pick dark and then light again.
   *
   * The visual flash it was guarding against does not exist anyway: the boot
   * script in the layout has already painted the right palette. Only this
   * indicator lags, by one frame, and syncing it in an effect is correct.
   */
  const [theme, setTheme] = useState<"system" | "light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = window.localStorage.getItem("cachet:theme");
      if (saved === "light" || saved === "dark" || saved === "system") setTheme(saved);
    } catch {
      /* storage blocked; the default stands */
    }
  }, []);
  const [wide, setWide] = useState(true);
  const [sheet, setSheet] = useState(false);
  const railRef = useRef<HTMLElement>(null);

  /*
   * Is the rail currently a drawer, rather than permanent navigation?
   *
   * Listening only to the media query's `change` event is not enough: it does
   * not fire reliably for every way a viewport can change size, and a missed
   * event here leaves the desktop rail marked inert - unreachable permanent
   * navigation, which is a worse bug than the one being fixed. `resize` always
   * fires, so both feed the same setter and React drops the duplicate updates.
   */
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width:860px)");
    const sync = () => setDrawer(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  /*
   * Keep the CLOSED drawer out of the tab order.
   *
   * Below 860px the rail is a full-screen drawer parked off the left edge with
   * `opacity:0; pointer-events:none`. Neither of those removes anything from
   * the tab order, so a keyboard user reached eight invisible links before the
   * page itself. `inert` takes the whole subtree out of both the tab order and
   * the accessibility tree, and is set imperatively because React 18 does not
   * recognise the attribute.
   */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    if (drawer && !sheet) rail.setAttribute("inert", "");
    else rail.removeAttribute("inert");
  }, [drawer, sheet]);

  /*
   * Write the RESOLVED palette to the root, where globals.css reads it, and
   * keep following the OS for as long as System is the choice.
   *
   * The attribute is never removed: globals.css defines light and dark only,
   * so an absent attribute would silently mean light. The user's choice and
   * the resolved palette are two different things, and only the first is
   * stored.
   */
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const resolved = theme === "system" ? (prefersLight.matches ? "light" : "dark") : theme;
      root.setAttribute("data-theme", resolved);
    };
    apply();
    try {
      window.localStorage.setItem("cachet:theme", theme);
    } catch {
      /* storage blocked; the choice simply does not persist */
    }
    if (theme !== "system") return;
    prefersLight.addEventListener("change", apply);
    return () => prefersLight.removeEventListener("change", apply);
  }, [theme, mounted]);

  // A route change closes the mobile sheet. Without this the rail stays over
  // the page you just navigated to, which reads as a broken link.
  useEffect(() => {
    setSheet(false);
  }, [pathname]);

  const active = useCallback(
    (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href)),
    [pathname],
  );

  return (
    <div id="appwrap" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--shell)" }}>
      {/* topbar */}
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px clamp(18px,2.6vw,32px)",
          borderBottom: "1px solid var(--track)",
          whiteSpace: "nowrap",
        }}
      >
        <button
          id="railtoggle"
          type="button"
          aria-label="Menu"
          aria-expanded={sheet}
          onClick={() => setSheet(!sheet)}
          style={{ display: "none", alignItems: "center", justifyContent: "center", width: 34, height: 34, border: "1px solid var(--line)", borderRadius: 7, background: "transparent", color: "var(--fg2)", cursor: "pointer" }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M3 6h14M3 10h14M3 14h14" />
          </svg>
        </button>

        <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".16em", color: "var(--dim)" }}>dAPP</span>

        <div id="themesw" role="radiogroup" aria-label="Theme" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 2, padding: 2, border: "1px solid var(--line)", borderRadius: 9999 }}>
          {(
            [
              ["system", "System theme", <path key="a" d="M3 4h18v12H3zM9 20h6M12 16v4" />],
              ["light", "Light theme", <g key="b"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></g>],
              ["dark", "Dark theme", <path key="c" d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mounted && theme === value}
              aria-label={label}
              data-on={mounted && theme === value ? "1" : "0"}
              onClick={() => setTheme(value)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                {icon}
              </svg>
            </button>
          ))}
        </div>

        {address ? (
          <span
            title={address}
            style={{ display: "inline-flex", alignItems: "center", gap: 9, height: 34, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 7, background: "var(--pill)", fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--fg)" }}
          >
            <i style={{ width: 14, height: 14, borderRadius: 4, background: "linear-gradient(140deg,var(--wax),#8C2818)", display: "block" }} />
            {shortAddress(address)}
          </span>
        ) : (
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 34, padding: "0 14px", border: "1px solid var(--line)", borderRadius: 7, background: "linear-gradient(145deg,#B93A24,#8C2818)", color: "#F6EEDE", fontFamily: "var(--sans)", fontSize: 13.5, fontWeight: 500, cursor: "pointer", boxShadow: "0 0 20px rgba(166,50,31,.32)" }}
          >
            <i style={{ width: 6, height: 6, borderRadius: "50%", background: "#F6C7BB", display: "block" }} />
            {busy ? "Connecting" : "Connect Wallet"}
          </button>
        )}

        <Link
          href="/"
          aria-label="Back to the landing page"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 34, padding: "0 13px", border: "1px solid var(--line)", borderRadius: 7, background: "transparent", color: "var(--fg2)", fontFamily: "var(--sans)", fontSize: 13.5, fontWeight: 450 }}
        >
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
          Exit
        </Link>
      </div>

      <div id="appgrid" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "auto 1fr" }}>
        <nav
          ref={railRef}
          id="apprail"
          aria-label="Sections"
          data-wide={wide ? "1" : "0"}
          data-sheet={sheet ? "1" : "0"}
          onMouseEnter={() => setWide(true)}
          onMouseLeave={() => setWide(false)}
          style={{ borderRight: "1px solid var(--track)", padding: "16px 12px", display: "flex", flexDirection: "column", overflowY: "auto", overflowX: "hidden" }}
        >
          <button
            id="railclose"
            type="button"
            aria-label="Close menu"
            onClick={() => setSheet(false)}
            style={{ display: "none", position: "absolute", top: 22, right: 22, alignItems: "center", justifyContent: "center", width: 38, height: 38, border: "1px solid var(--line)", borderRadius: 9999, background: "transparent", color: "var(--fg2)", cursor: "pointer" }}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>

          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 8px 0", color: "inherit" }}>
            <Mark size={22} />
            <span data-lbl="" style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, letterSpacing: "-.3px", color: "var(--fg)" }}>
              Cachet
            </span>
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 0", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 7, background: "var(--tint2)", color: "var(--fg2)" }}>
            <i style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", background: "var(--pop)", boxShadow: "0 0 8px rgba(127,208,138,.8)" }} />
            <span data-lbl="" style={{ flex: 1, minWidth: 0, fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".12em", overflow: "hidden", textOverflow: "ellipsis" }}>
              {network.toUpperCase()}
            </span>
          </div>

          <div style={{ height: 1, background: "var(--line2)", margin: "14px 0" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Group label="TENDERING">
              <RailLink href="/rounds" label="Docket" badge={counts.rounds} active={active("/rounds")} icon={<path d="M7 5h11M7 10h11M7 15h11M3.5 5h.01M3.5 10h.01M3.5 15h.01" />} />
              <RailLink href="/publish" label="Publish" active={active("/publish")} icon={<path d="M10 4v12M4 10h12" />} />
              <RailLink href="/exhibit" label="A finished round" active={active("/exhibit")} icon={<path d="M4 16V9M9 16V4M14 16v-5M19 16v-9" />} />
            </Group>

            <Group label="RECORDS">
              <RailLink href="/docs" label="How it works" active={active("/docs")} icon={<path d="M7 6l-4 4 4 4M14 6l4 4-4 4" />} />
            </Group>
          </div>

          <div style={{ marginTop: "auto" }}>
            <div style={{ height: 1, background: "var(--line2)", margin: "14px 0" }} />
            {address ? (
              <Link
                href={`/bidders/${address}`}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: 9, border: "1px solid var(--line)", borderRadius: 8, background: "var(--tint2)", color: "var(--fg)" }}
              >
                <span style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(140deg,var(--wax),#8C2818)", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "#F6EEDE" }}>
                  {address.slice(2, 4)}
                </span>
                <span data-lbl="" style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: "var(--mono)", fontSize: 11.5 }}>{shortAddress(address)}</span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--dim)", marginTop: 3 }}>Your record</span>
                </span>
              </Link>
            ) : (
              <p data-lbl="" style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--dim)", padding: "0 2px" }}>
                Connect a wallet to see your own record.
              </p>
            )}
          </div>
        </nav>

        <div id="appmain" style={{ minHeight: 0, overflowY: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        data-open={open ? "1" : "0"}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", border: "none", background: "transparent", color: "var(--dim)", cursor: "pointer", textAlign: "left" }}
      >
        <span data-lbl="" style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".16em", color: "var(--dim)", whiteSpace: "nowrap", flex: 1 }}>
          {label}
        </span>
        <span data-gchev="" style={{ display: "flex" }}>
          <svg width="15" height="15" viewBox="0 0 21 21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ flex: "none" }} aria-hidden="true">
            <path d="M5 8l5 5 5-5" />
          </svg>
        </span>
      </button>
      <div data-secbody="" data-open={open ? "1" : "0"} style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 3 }}>
        {children}
      </div>
    </div>
  );
}

function RailLink({
  href,
  label,
  icon,
  badge,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** null when the count could not be read. Never a placeholder. */
  badge?: number | null;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      data-active={active ? "1" : "0"}
      aria-current={active ? "page" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", border: "1px solid transparent", borderRadius: 7, color: "var(--fg3)", fontSize: 14, fontWeight: 440 }}
    >
      <svg width="15" height="15" viewBox="0 0 21 21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ flex: "none" }} aria-hidden="true">
        {icon}
      </svg>
      <span data-lbl="" style={{ flex: 1, minWidth: 0 }}>
        {label}
      </span>
      {typeof badge === "number" ? (
        <span data-badge="" style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
