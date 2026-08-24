"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Mark } from "./Mark";
import { ADD_CHAIN_PARAMS, CHAIN_ID_HEX } from "@/lib/chain";
import { readableError } from "@/components/wallet";

/**
 * The wallet step between the landing and the dApp.
 *
 * It lists the EVM wallets actually installed in THIS browser, discovered
 * through EIP-6963, each under its own name and its own icon. Nothing is
 * hardcoded: an earlier version offered a fixed "GenLayer" and "MetaMask"
 * pair, and there is no GenLayer wallet extension - so one of the two buttons
 * named something that cannot be installed, while a reader using Rabby, Brave,
 * Coinbase Wallet or anything else saw no way in at all.
 *
 * Discovery rather than `window.ethereum` matters beyond the list, too. With
 * two wallets installed, `window.ethereum` is whichever extension won the race
 * to inject itself, so a button labelled with one wallet can hand back an
 * account from another. Every address here becomes a bidder identity bound
 * into a commitment hash, so connecting the wrong one is not cosmetic.
 *
 * There is no way in without a wallet. Typing an address is not evidence of
 * holding its key, and this screen does not pretend otherwise - the paste box
 * that used to sit here is gone. Public records stay public and reachable from
 * the docket, which needs no wallet and claims nothing about who is reading.
 */

/** What an EIP-6963 wallet announces about itself. */
type ProviderInfo = { uuid: string; name: string; rdns: string; icon: string };
type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
};
type Announced = { info: ProviderInfo; provider: Eip1193 };

/**
 * Wallets that inject but never announce.
 *
 * EIP-6963 is the standard and every current wallet implements it, but an old
 * install can still be sitting on `window.ethereum` alone. Rather than drop
 * that reader at a dead end, it is offered as one clearly generic entry - and
 * only when nothing announced, so it can never sit next to named wallets
 * pretending to be a different one.
 */
const LEGACY_UUID = "legacy-window-ethereum";

export default function Connect({ network, onBack }: { network: string; onBack: () => void }) {
  const router = useRouter();
  const [wallets, setWallets] = useState<Announced[]>([]);
  /** Null until discovery has had a chance to answer, so "none" is not claimed early. */
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  /**
   * EIP-6963 discovery.
   *
   * Listen first, then ask: wallets that already announced on page load
   * re-announce on `eip6963:requestProvider`, and doing it the other way round
   * misses every wallet that was ready before this component mounted, which is
   * most of them.
   */
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announced>).detail;
      if (!detail?.info?.uuid || !detail.provider) return;
      setWallets((prev) =>
        prev.some((p) => p.info.uuid === detail.info.uuid) ? prev : [...prev, detail],
      );
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Announcements are synchronous in practice, but a slow extension can be a
    // frame or two behind. A short grace period keeps "no wallet found" from
    // flashing up in front of somebody who has one.
    const t = setTimeout(() => setScanned(true), 350);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  /** The announced list, plus a legacy entry only when nothing announced. */
  const [legacy, setLegacy] = useState<Announced | null>(null);
  useEffect(() => {
    if (!scanned || wallets.length > 0) {
      setLegacy(null);
      return;
    }
    const eth = (window as { ethereum?: Eip1193 }).ethereum;
    if (!eth) return;
    setLegacy({
      info: {
        uuid: LEGACY_UUID,
        // Deliberately not guessed at. `isMetaMask` is set by wallets that are
        // not MetaMask, so a name read off it would be a label we cannot stand
        // behind on the one screen where the label has to be true.
        name: "Browser wallet",
        rdns: LEGACY_UUID,
        icon: "",
      },
      provider: eth,
    });
  }, [scanned, wallets.length]);

  const shown = wallets.length > 0 ? wallets : legacy ? [legacy] : [];

  const connect = useCallback(
    async (wallet: Announced) => {
      setError("");
      setBusy(wallet.info.uuid);
      try {
        const accounts = (await wallet.provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        if (!accounts?.length) throw new Error("The wallet returned no account.");

        try {
          await wallet.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CHAIN_ID_HEX }],
          });
        } catch (switchError) {
          // 4902: the wallet has never heard of this chain. Same params object
          // the read client derives from the SDK, so the two cannot drift.
          if ((switchError as { code?: number })?.code === 4902) {
            await wallet.provider.request({
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
    [router],
  );

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
          moment rather than a moving one. Blooms at the edges, a dark well
          under the panel, so the text sits on the darkest part of the field. */}
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
          style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-.4px", color: "#F1EAD9" }}
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

        {/* Three states, and only one of them is a list. */}
        {!scanned && shown.length === 0 ? (
          <p
            style={{
              margin: "20px 0 0",
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "rgba(241,234,217,.58)",
              animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 140ms both",
            }}
          >
            Looking for wallets...
          </p>
        ) : shown.length === 0 ? (
          <div
            style={{
              margin: "20px auto 0",
              maxWidth: "36ch",
              animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 140ms both",
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: "var(--sans)",
                fontSize: 13,
                lineHeight: 1.65,
                color: "#F0C3B6",
              }}
            >
              <strong style={{ color: "#F6D8CE" }}>No EVM wallet found in this browser.</strong>{" "}
              Bidding needs one, because a sealed bid is signed by the address it belongs to.
            </p>
            <p
              style={{
                margin: "12px 0 0",
                fontFamily: "var(--sans)",
                fontSize: 12,
                lineHeight: 1.65,
                color: "rgba(241,234,217,.62)",
              }}
            >
              Install{" "}
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: "#F6D8CE" }}
              >
                MetaMask
              </a>
              ,{" "}
              <a
                href="https://rabby.io/"
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: "#F6D8CE" }}
              >
                Rabby
              </a>{" "}
              or any other EVM wallet, then reload. Reading the docket needs no wallet at all.
            </p>
            <button
              type="button"
              onClick={onBack}
              style={{
                marginTop: 16,
                height: 36,
                padding: "0 16px",
                border: "1px solid rgba(241,234,217,.16)",
                borderRadius: 7,
                background: "rgba(22,19,14,.6)",
                color: "#F1EAD9",
                fontFamily: "var(--sans)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Back to the site
            </button>
          </div>
        ) : (
          <>
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
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 10,
                animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 200ms both",
              }}
            >
              {shown.map((w) => {
                const isBusy = busy === w.info.uuid;
                return (
                  <button
                    key={w.info.uuid}
                    type="button"
                    onClick={() => connect(w)}
                    disabled={busy !== null}
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
                      background:
                        "linear-gradient(145deg,rgba(58,34,26,.92),rgba(34,22,17,.92))",
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
                    {/* The wallet's own icon, as it announced it. EIP-6963
                        requires a data URI, so this loads no third party and
                        the button shows the wallet actually being talked to
                        rather than a logo we drew for it. */}
                    {w.info.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={w.info.icon}
                        alt=""
                        width={18}
                        height={18}
                        style={{ borderRadius: 4, display: "block", flexShrink: 0 }}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          background: "linear-gradient(145deg,#C4472E,#8C2818)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,.22)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {isBusy ? "Waiting..." : w.info.name}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {error ? (
          <p
            role="alert"
            style={{
              margin: "16px auto 0",
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

        {shown.length > 0 ? (
          <p
            style={{
              margin: "20px auto 0",
              maxWidth: "36ch",
              fontFamily: "var(--sans)",
              fontSize: 11.5,
              lineHeight: 1.65,
              color: "rgba(241,234,217,.58)",
              animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 320ms both",
            }}
          >
            Connecting only proves the address. Sealing a bid is a separate signature you approve
            per round.
          </p>
        ) : null}

        <p
          style={{
            margin: "12px 0 0",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "rgba(241,234,217,.62)",
            animation: "cn-rise 560ms cubic-bezier(.16,1,.3,1) 380ms both",
          }}
        >
          {network}
        </p>
      </div>
    </section>
  );
}
