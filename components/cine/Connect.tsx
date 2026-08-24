"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Mark } from "./Mark";
import { ADD_CHAIN_PARAMS, CHAIN_ID_HEX } from "@/lib/chain";
import { readableError } from "@/components/wallet";

/**
 * The wallet step between the landing and the dApp.
 *
 * Two named wallets and a paste box, which is three different promises, so the
 * screen has to keep them apart:
 *
 * - **GenLayer / MetaMask** connect a signer. The button names a wallet, so it
 *   has to reach THAT wallet: `window.ethereum` is whichever extension won the
 *   race to inject itself, and with two installed, clicking "MetaMask" through
 *   it can hand back a GenLayer account. Every address here is a bidder
 *   identity bound into a commitment hash, so connecting the wrong one is not
 *   cosmetic. EIP-6963 is how a page asks for a wallet by name, and it is what
 *   this uses.
 * - **Paste an address** proves nothing at all and is not offered as if it
 *   did. It opens that address's public record, which is readable by anyone
 *   with or without a wallet. It never becomes a connected session, because
 *   typing an address is not evidence of holding its key.
 *
 * A wallet that is not installed says so. The alternative - quietly falling
 * back to whatever else is injected - is the failure this screen exists to
 * avoid.
 */

/** What an EIP-6963 wallet announces about itself. */
type ProviderInfo = { uuid: string; name: string; rdns: string; icon: string };
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
type Announced = { info: ProviderInfo; provider: Eip1193 };

/**
 * The wallets this screen offers, in the handoff's order.
 *
 * Matched on `rdns` first, which is the identifier a wallet controls and
 * therefore the one it cannot be confused about. The name test is a fallback
 * for wallets shipping a non-canonical rdns, and it is deliberately narrow.
 */
const WALLETS = [
  {
    key: "genlayer",
    label: "GenLayer",
    match: (i: ProviderInfo) =>
      i.rdns.toLowerCase().includes("genlayer") || /genlayer/i.test(i.name),
    /** Where to send somebody who does not have it. */
    site: "https://genlayer.com",
  },
  {
    key: "metamask",
    label: "MetaMask",
    match: (i: ProviderInfo) => i.rdns.toLowerCase() === "io.metamask" || /^metamask/i.test(i.name),
    site: "https://metamask.io/download/",
  },
] as const;

export default function Connect({
  network,
  onBack,
}: {
  network: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [found, setFound] = useState<Announced[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<(typeof WALLETS)[number] | null>(null);
  const [typed, setTyped] = useState("");

  /**
   * EIP-6963 discovery.
   *
   * The page listens first and then announces its interest, because wallets
   * that already fired on page load re-announce on `eip6963:requestProvider`.
   * Doing it the other way round misses every wallet that was ready before
   * this component mounted, which is most of them.
   */
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announced>).detail;
      if (!detail?.info?.uuid) return;
      setFound((prev) =>
        prev.some((p) => p.info.uuid === detail.info.uuid) ? prev : [...prev, detail],
      );
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  const available = useMemo(() => {
    const map: Record<string, Announced | undefined> = {};
    for (const w of WALLETS) map[w.key] = found.find((f) => w.match(f.info));
    return map;
  }, [found]);

  const connect = useCallback(
    async (wallet: (typeof WALLETS)[number]) => {
      setError("");
      setMissing(null);

      const announced = available[wallet.key];
      // No silent substitution. `window.ethereum` would answer here, and it is
      // not necessarily the wallet whose name was on the button.
      if (!announced) {
        setMissing(wallet);
        return;
      }

      setBusy(wallet.key);
      try {
        const accounts = (await announced.provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        if (!accounts?.length) throw new Error("The wallet returned no account.");

        try {
          await announced.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CHAIN_ID_HEX }],
          });
        } catch (switchError) {
          // 4902: the wallet has never heard of this chain. Same params object
          // the read client derives from the SDK, so the two cannot drift.
          if ((switchError as { code?: number })?.code === 4902) {
            await announced.provider.request({
              method: "wallet_addEthereumChain",
              params: [ADD_CHAIN_PARAMS],
            });
          } else {
            throw switchError;
          }
        }
        router.push("/rounds");
      } catch (e) {
        setError(readableError(e));
      } finally {
        setBusy(null);
      }
    },
    [available, router],
  );

  const address = typed.trim();
  const addressOk = /^0x[0-9a-fA-F]{40}$/.test(address);

  const openRecord = useCallback(() => {
    if (!addressOk) return;
    router.push(`/bidders/${address}`);
  }, [address, addressOk, router]);

  return (
    <section
      style={{
        position: "absolute",
        inset: 0,
        background: "#0B0907",
        overflow: "hidden",
        animation: "cn-fade 420ms cubic-bezier(.16,1,.3,1) both",
      }}
    >
      {/* The landing's wax bloom, without the video: this screen is a held
          moment rather than a moving one, and a looping hero behind a wallet
          prompt reads as decoration competing with a decision. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 58% 52% at 50% 50%,rgba(11,9,7,.86) 0%,rgba(11,9,7,.52) 46%,transparent 78%),radial-gradient(ellipse 34% 40% at 16% 18%,rgba(178,56,34,.34) 0%,rgba(166,50,31,.07) 46%,transparent 72%),radial-gradient(ellipse 42% 58% at 88% 34%,rgba(178,56,34,.32) 0%,rgba(166,50,31,.07) 44%,transparent 70%),radial-gradient(ellipse 40% 34% at 22% 92%,rgba(150,44,26,.30) 0%,transparent 62%),radial-gradient(ellipse 34% 30% at 86% 94%,rgba(150,44,26,.24) 0%,transparent 60%),radial-gradient(ellipse at 50% 50%,transparent 30%,rgba(0,0,0,.46) 100%)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.05,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* brand pill */}
      <div
        style={{
          position: "absolute",
          top: "clamp(14px,2.1vh,22px)",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 9,
          height: 40,
          padding: "0 18px",
          border: "1px solid rgba(241,234,217,.15)",
          borderRadius: 9999,
          background: "rgba(22,19,14,.6)",
          backdropFilter: "blur(14px) saturate(112%)",
          WebkitBackdropFilter: "blur(14px) saturate(112%)",
          boxShadow: "0 10px 34px rgba(0,0,0,.42)",
          zIndex: 3,
        }}
      >
        <Mark size={20} />
        {/* The wordmark drops on a narrow phone. Centred brand plus a
            right-anchored "Back to site" needs about 420px; below that the two
            pills overlapped, and the mark alone still reads as the brand. */}
        <span
          className="cn-word"
          style={{
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: "-.4px",
            color: "#F1EAD9",
          }}
        >
          Cachet
        </span>
      </div>

      <button
        type="button"
        onClick={onBack}
        style={{
          position: "absolute",
          top: "clamp(14px,2.1vh,22px)",
          right: "clamp(20px,4vw,48px)",
          display: "flex",
          alignItems: "center",
          gap: 7,
          height: 34,
          padding: "0 15px 0 11px",
          border: "1px solid rgba(241,234,217,.15)",
          borderRadius: 9999,
          background: "rgba(22,19,14,.6)",
          backdropFilter: "blur(14px) saturate(112%)",
          WebkitBackdropFilter: "blur(14px) saturate(112%)",
          color: "rgba(241,234,217,.78)",
          fontFamily: "var(--sans)",
          fontSize: 13,
          letterSpacing: "-.2px",
          cursor: "pointer",
          zIndex: 3,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>
          &lsaquo;
        </span>
        Back to site
      </button>

      {/* ================= the panel ================= */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(420px,calc(100vw - 40px))",
          textAlign: "center",
          zIndex: 2,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--display)",
            fontWeight: 400,
            fontSize: "clamp(30px,4.4vw,40px)",
            lineHeight: 1.08,
            letterSpacing: "-1px",
            color: "#F6EEDE",
            textShadow: "0 2px 18px rgba(0,0,0,.5)",
            animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 60ms both",
          }}
        >
          Connect
          <br />
          your wallet
        </h1>

        <p
          style={{
            margin: "18px 0 12px",
            fontFamily: "var(--sans)",
            fontSize: 12.5,
            letterSpacing: ".01em",
            color: "rgba(241,234,217,.56)",
            animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 140ms both",
          }}
        >
          Continue with
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 10,
            animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 200ms both",
          }}
        >
          {WALLETS.map((w) => {
            const announced = available[w.key];
            const isBusy = busy === w.key;
            return (
              <button
                key={w.key}
                type="button"
                onClick={() => connect(w)}
                disabled={busy !== null}
                // Not disabled when absent: the button still has something
                // useful to say, and a dead control explains nothing.
                title={announced ? `Connect with ${announced.info.name}` : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 9,
                  minWidth: 100,
                  height: 40,
                  padding: "0 16px",
                  border: "1px solid rgba(241,234,217,.16)",
                  borderRadius: 8,
                  background: "linear-gradient(145deg,rgba(58,34,26,.92),rgba(34,22,17,.92))",
                  color: "#F6EEDE",
                  fontFamily: "var(--sans)",
                  fontSize: 13.5,
                  fontWeight: 500,
                  letterSpacing: "-.2px",
                  cursor: busy ? "wait" : "pointer",
                  opacity: busy && !isBusy ? 0.5 : 1,
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,.10),0 1px 5px rgba(0,0,0,.4),0 0 18px rgba(166,50,31,.18)",
                }}
              >
                {/* The wallet's own icon when it announced one, so the button
                    shows the wallet actually being talked to rather than a
                    logo we drew for it. */}
                {announced?.info.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={announced.info.icon}
                    alt=""
                    width={16}
                    height={16}
                    style={{ borderRadius: 4, display: "block" }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: "linear-gradient(145deg,#C4472E,#8C2818)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,.22)",
                    }}
                  />
                )}
                {isBusy ? "Waiting..." : w.label}
              </button>
            );
          })}
        </div>

        {/* What the click actually did, when it did not open a wallet. */}
        {missing ? (
          <p
            style={{
              margin: "14px auto 0",
              maxWidth: "34ch",
              fontFamily: "var(--sans)",
              fontSize: 12,
              lineHeight: 1.6,
              color: "#F0C3B6",
            }}
          >
            {missing.label} did not answer, so it is probably not installed in this browser.
            Nothing else was connected in its place - another wallet would sign with a different
            address.{" "}
            <a
              href={missing.site}
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: "#F6D8CE", textDecoration: "underline" }}
            >
              Install {missing.label}
            </a>
            , then reload.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            style={{
              margin: "14px auto 0",
              maxWidth: "34ch",
              fontFamily: "var(--sans)",
              fontSize: 12,
              lineHeight: 1.6,
              color: "#F0C3B6",
            }}
          >
            {error}
          </p>
        ) : null}

        {/* ================= or ================= */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            margin: "22px 0 14px",
            animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 260ms both",
          }}
        >
          <span style={{ flex: 1, height: 1, background: "rgba(241,234,217,.13)" }} />
          <span
            style={{
              fontFamily: "var(--sans)",
              fontSize: 10,
              letterSpacing: ".18em",
              color: "rgba(241,234,217,.58)",
            }}
          >
            OR
          </span>
          <span style={{ flex: 1, height: 1, background: "rgba(241,234,217,.13)" }} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            openRecord();
          }}
          style={{ animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 320ms both" }}
        >
          <label htmlFor="cn-addr" className="sr-only">
            Paste an address to open its public record
          </label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 42,
              padding: "0 12px",
              border: `1px solid ${address && !addressOk ? "rgba(232,120,94,.5)" : "rgba(241,234,217,.14)"}`,
              borderRadius: 8,
              background: "rgba(22,19,14,.58)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
          >
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(241,234,217,.55)"
              strokeWidth="1.7"
              style={{ flexShrink: 0 }}
            >
              <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
              <path d="M2.5 10h19" />
            </svg>
            <input
              id="cn-addr"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Paste an address"
              spellCheck={false}
              autoComplete="off"
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                outline: "none",
                background: "transparent",
                color: "#F1EAD9",
                fontFamily: "var(--mono)",
                fontSize: 13,
                letterSpacing: "-.1px",
              }}
            />
            {addressOk ? (
              <button
                type="submit"
                style={{
                  flexShrink: 0,
                  height: 28,
                  padding: "0 11px",
                  border: "1px solid rgba(241,234,217,.16)",
                  borderRadius: 6,
                  background: "linear-gradient(145deg,#B93A24,#8C2818)",
                  color: "#F6EEDE",
                  fontFamily: "var(--sans)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Open
              </button>
            ) : null}
          </div>
          {address && !addressOk ? (
            <p
              style={{
                margin: "8px 0 0",
                fontFamily: "var(--sans)",
                fontSize: 11.5,
                color: "#F0C3B6",
              }}
            >
              That is not an address. It should be 0x followed by 40 hexadecimal characters.
            </p>
          ) : null}
        </form>

        <p
          style={{
            margin: "16px auto 0",
            maxWidth: "36ch",
            fontFamily: "var(--sans)",
            fontSize: 11.5,
            lineHeight: 1.65,
            color: "rgba(241,234,217,.58)",
            animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 380ms both",
          }}
        >
          Connecting only proves the address. Sealing a bid is a separate signature you approve
          per round. A pasted address only opens its public record.
        </p>

        <p
          style={{
            margin: "10px 0 0",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "rgba(241,234,217,.62)",
            animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 420ms both",
          }}
        >
          {network}
        </p>
      </div>
    </section>
  );
}
