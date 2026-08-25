"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { recoverMessageAddress } from "viem";
import { useRouter } from "next/navigation";

import { Mark } from "./Mark";
import { ADD_CHAIN_PARAMS, CHAIN_ID_HEX, NETWORK_LABEL } from "@/lib/chain";
import { readableError, useWallet } from "@/components/wallet";
import { type Announced, remember, wallets } from "@/components/providers";

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
 * that used to sit here is gone.
 *
 * What that gates is the APP, not the record. Every route stays readable at
 * its own url, so a link to a round, a scorecard or a bidder's history opens
 * for anyone, with or without a wallet, and that has to stay true: a product
 * whose claim is that a losing bidder can check the scoring cannot put the
 * scoring behind a wallet. The header asks who you are because the header is
 * the way in to doing something. Reading is not doing something.
 */

/**
 * What the wallet is asked to sign.
 *
 * Names this origin, the address and the network, and carries a per-visit
 * nonce. Plain text on purpose: a person approving it in their wallet should
 * be able to read exactly what they are agreeing to, and "sign this opaque
 * hex" is how signature prompts get approved without being read.
 */
function signInMessage(address: string, nonce: string): string {
  const origin = typeof window !== "undefined" ? window.location.host : "cachet";
  return [
    `${origin} is checking that this wallet can sign.`,
    "",
    `Address: ${address}`,
    `Network: ${NETWORK_LABEL}`,
    `Nonce: ${nonce}`,
    "",
    "This authorises nothing and moves no funds.",
  ].join("\n");
}

export default function Connect({
  network,
  destination,
  onBack,
}: {
  network: string;
  /** Where the reader was heading when this step interrupted them. */
  destination: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const wallet = useWallet();
  const [shown, setShown] = useState<Announced[]>([]);
  /** False until discovery has had a chance to answer, so "none" is not claimed early. */
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  /** Which of the handoff's two steps is showing. */
  const [step, setStep] = useState<"wallet" | "approve">("wallet");
  const [picked, setPicked] = useState<{ wallet: Announced; address: string } | null>(null);
  /** The overlay the design draws over both steps. */
  const [phase, setPhase] = useState<"idle" | "signing" | "done">("idle");

  /**
   * One nonce per visit to this screen.
   *
   * It makes the message unique so a signature captured from somewhere else
   * cannot be replayed into this one. Generated with `crypto.getRandomValues`
   * rather than `Math.random`, which is not unpredictable and has no business
   * anywhere near a challenge.
   */
  const nonce = useMemo(() => {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }, []);

  /**
   * The wallets installed in this browser.
   *
   * Discovery lives in `components/providers.ts` because the rest of the app
   * needs the same answer: the choice made here decides which provider signs
   * every later transaction, so both sides have to resolve wallets identically.
   */
  useEffect(() => {
    let cancelled = false;
    wallets().then((found) => {
      if (cancelled) return;
      setShown(found);
      setScanned(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        // Recorded before the signature step, and by `rdns` rather than the
        // announced uuid: a uuid is generated per page load, so it names the
        // announcement rather than the wallet and would never match again.
        // Everything downstream - the account the app displays, and the
        // provider the SDK signs through - resolves from this.
        remember(wallet.info.rdns);
        setPicked({ wallet, address: accounts[0] });
        setStep("approve");
      } catch (e) {
        setError(readableError(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  /**
   * The handoff's second step: sign, and CHECK the signature.
   *
   * The design draws a sign-in message and an "Approve in wallet" button. Read
   * literally that is a login, and a login here would be theatre: nothing on
   * this site has a server session, and the contract authorises writes from
   * `gl.message.sender_address` - the transaction's own signer - so a
   * signature the page collected proves nothing to anything downstream.
   *
   * What it IS good for is worth the step. It asks the wallet to sign now,
   * before an entry deposit is spent, and then RECOVERS the address from the
   * signature and compares. That catches, at the cheapest possible moment, the
   * two cases where somebody would otherwise discover the problem halfway
   * through sealing a bid: a watch-only or imported address the wallet cannot
   * sign for, and a wallet that hands back a different account than the one it
   * just reported.
   *
   * So the copy says what it does rather than "sign in", and the recovery is
   * real rather than decorative. A signature nobody verifies would be a worse
   * lie than not asking for one.
   */
  const approve = useCallback(async () => {
    if (!picked) return;
    setError("");
    setPhase("signing");
    try {
      const message = signInMessage(picked.address, nonce);
      const signature = (await picked.wallet.provider.request({
        method: "personal_sign",
        params: [message, picked.address],
      })) as string;

      /**
       * Both failures read the same to a person, so they say the same thing.
       *
       * A malformed signature makes `recoverMessageAddress` throw with its own
       * wording - "Invalid yParityOrV value" reached the screen during
       * testing - and a well-formed signature from another key recovers
       * cleanly to the wrong address. Neither is something a reader can act on
       * as stated, and both mean exactly one thing: this wallet did not prove
       * it holds this address.
       */
      let signer = "";
      try {
        signer = await recoverMessageAddress({
          message,
          signature: signature as `0x${string}`,
        });
      } catch {
        signer = "";
      }
      if (!signer || signer.toLowerCase() !== picked.address.toLowerCase()) {
        throw new Error(
          "That signature does not belong to this address, so nothing was connected. It usually means the wallet is watching the account rather than holding its key.",
        );
      }

      /**
       * Tell the shared wallet state to look again.
       *
       * It read the account once when the app mounted, and at that moment
       * nothing was chosen yet - so without this the connection succeeds, the
       * choice is stored, and the header chip stays empty until a reload.
       * Measured: connected through the gate, landed on the docket, and the
       * chip still offered "Connect wallet".
       */
      await wallet.refresh();

      setPhase("done");
      // A beat on the confirmation, which is the design's own done state, then
      // on to wherever they were heading.
      setTimeout(() => router.push(destination), 900);
    } catch (e) {
      setPhase("idle");
      setError(readableError(e));
    }
  }, [destination, nonce, picked, router, wallet]);

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
          {step === "approve" ? (
            <>One last step</>
          ) : (
            <>
              Connect
              <br />
              your wallet
            </>
          )}
        </h1>

        {/* Three states, and only one of them is a list. */}
        {step === "approve" ? null : !scanned && shown.length === 0 ? (
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
              or any other EVM wallet, then reload.
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

        {/* Step two, and the overlay the design draws over both. */}
        {step === "approve" && picked ? (
          <div className="gate-approve">
            <p className="gate-approve-lede">
              Sign this message so the wallet proves it can sign for this address
            </p>
            <pre className="gate-message">{signInMessage(picked.address, nonce)}</pre>
            <button
              type="button"
              className="btn btn-primary btn-small gate-approve-go"
              onClick={() => void approve()}
              disabled={phase !== "idle"}
            >
              {phase === "signing" ? "Waiting for the wallet..." : "Approve in wallet"}
            </button>
            <button
              type="button"
              className="gate-back"
              onClick={() => {
                setStep("wallet");
                setPicked(null);
                setError("");
              }}
            >
              Go back
            </button>
            <p className="gate-approve-note">
              This authorises nothing and moves no funds. Sealing a bid is a separate signature
              you approve per round.
            </p>
          </div>
        ) : null}

        {phase !== "idle" ? (
          <div className="gate-busy" role="status" aria-live="polite">
            <div className="gate-busy-card">
              {phase === "signing" ? (
                <>
                  <span className="gate-spinner" aria-hidden="true" />
                  <p className="gate-busy-title">Waiting for the wallet</p>
                  <p className="gate-busy-sub">Approve the message in your wallet to continue.</p>
                </>
              ) : (
                <>
                  <span className="gate-tick" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0B0907" strokeWidth="2.4">
                      <path d="M4 12.6l5.2 5.2L20 7" />
                    </svg>
                  </span>
                  <p className="gate-busy-title">Wallet connected</p>
                  <p className="gate-busy-sub mono">{picked ? picked.address : ""}</p>
                </>
              )}
            </div>
          </div>
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
