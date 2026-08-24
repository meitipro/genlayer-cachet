/**
 * The single place that decides WHICH GenLayer network the whole app talks to.
 *
 * Cachet runs on Studio. Everything the product does - escrow, sealed
 * commitments, scoring, award - runs there, so a full round with several
 * bidders can be driven end to end before anyone commits a real budget.
 *
 * Flip with one env var once Bradbury is the target:
 *   NEXT_PUBLIC_GENLAYER_NETWORK=bradbury
 *
 * What Studio cannot tell you is the number this product most needs: it is
 * gasless, so a receipt from here says nothing about what it costs to score a
 * round with twenty long proposals on a live network. That measurement is a
 * launch blocker, not a nice-to-have, and /docs says so on the page.
 *
 * Everything below derives from genlayer-js's own chain objects rather than
 * being retyped, so chain id, RPC url and currency cannot drift from the SDK.
 */

import { studionet, testnetBradbury } from "genlayer-js/chains";

export type NetworkId = "studionet" | "bradbury";

const RAW = (process.env.NEXT_PUBLIC_GENLAYER_NETWORK || "studionet")
  .trim()
  .toLowerCase();

export const NETWORK: NetworkId =
  RAW === "bradbury" || RAW === "testnet_bradbury" || RAW === "testnetbradbury"
    ? "bradbury"
    : "studionet";

export const IS_STUDIO = NETWORK === "studionet";

/** The genlayer-js chain object to hand to createClient(). */
export const CHAIN = IS_STUDIO ? studionet : testnetBradbury;

export const NETWORK_LABEL = IS_STUDIO ? "GENLAYER STUDIO" : "TESTNET BRADBURY";

export const CHAIN_ID_HEX = `0x${CHAIN.id.toString(16)}` as const;

export const RPC_URL = CHAIN.rpcUrls.default.http[0];

/**
 * Explorer base url.
 *
 * genlayer-js points studionet at https://genlayer-explorer.vercel.app, which
 * answers 503 on every request. The host that actually works for Studio is
 * explorer-studio.genlayer.com. That one url is hardcoded rather than taken
 * from the SDK; everything else still derives.
 */
const EXPLORER_BASE = (
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER ??
  (IS_STUDIO
    ? "https://explorer-studio.genlayer.com"
    : CHAIN.blockExplorers?.default?.url || "")
).replace(/\/+$/, "");

export const HAS_EXPLORER = EXPLORER_BASE.length > 0;

export function explorerTx(hash: string): string {
  return EXPLORER_BASE ? `${EXPLORER_BASE}/tx/${hash}` : "";
}

export function explorerAddress(address: string): string {
  return EXPLORER_BASE ? `${EXPLORER_BASE}/address/${address}` : "";
}

/**
 * Studio reports eth_gasPrice = 0, and eth_getBalance answers 0x0 even for an
 * account that has just been funded and whose payable calls then succeed. A
 * pre-flight "you have no GEN" guard, correct on Bradbury, therefore refuses
 * every write on Studio before it is attempted - and on this product almost
 * every write is payable. On Studio the transaction itself is the judge.
 */
export const REQUIRES_GAS = !IS_STUDIO;

/**
 * Null when the active network has no faucet URL. Studio's is not a url - it
 * is the water-drop button inside studio.genlayer.com, and it funds Studio's
 * own accounts rather than an external wallet.
 */
export const FAUCET_URL: string | null = IS_STUDIO
  ? null
  : "https://testnet-faucet.genlayer.foundation/";

export const ADD_CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: CHAIN.name,
  rpcUrls: [...CHAIN.rpcUrls.default.http],
  nativeCurrency: CHAIN.nativeCurrency,
  ...(EXPLORER_BASE ? { blockExplorerUrls: [EXPLORER_BASE] } : {}),
};

/**
 * Trim, and DO NOT change the case.
 *
 * `gen_call` needs the EIP-55 checksummed spelling of a contract address: the
 * all-lowercase form of a live contract answers "Contract not found". This is
 * the exact opposite of the rule inside a contract, where an Address used as a
 * TreeMap key must be lowercased on both write and read - so the instinct
 * built by one is wrong for the other.
 *
 * Lowercasing here does not throw. Every read simply fails and every page goes
 * empty, which looks exactly like a contract that was never deployed.
 */
function normalise(value: string | undefined): `0x${string}` {
  return (value || "").trim() as `0x${string}`;
}

/** The deployed tender contract. Empty until one is deployed to this network. */
export const CACHET = normalise(process.env.NEXT_PUBLIC_CACHET_ADDRESS);

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * False until a contract address is configured.
 *
 * The site then says so, on every page, and shows nothing. There is no sample
 * data to fall back to anywhere in this codebase - on a product whose entire
 * claim is that the scoring is verifiable, a fabricated round rendering like a
 * real one would be the worst possible lie to tell.
 *
 * Note a contract address is per network: flipping the network without
 * redeploying points the app at an address that does not exist.
 */
export const IS_LIVE = ADDRESS_RE.test(CACHET);

const VERCEL_PRODUCTION_URL =
  process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;

export const ORIGIN =
  process.env.NEXT_PUBLIC_ORIGIN ||
  (VERCEL_PRODUCTION_URL
    ? `https://${VERCEL_PRODUCTION_URL}`
    : "http://localhost:4100");
