/**
 * Resumable run state for scripts/seed.mjs.
 *
 * The seed waits on the real clock - a commit window has to actually close
 * before a reveal can be refused for being early - so a full run takes the
 * better part of an hour and gets interrupted: a rate limit storm, a dropped
 * TLS connection, a closed terminal. Losing the run is not the problem.
 * Losing the BIDDER KEYS is: without them the five sealed commitments on chain
 * can never be opened, and the round dies holding an escrowed budget.
 *
 * So every generated key, every salt and every completed step is written here
 * as it happens, keyed by contract address, and a second run picks up exactly
 * where the first stopped.
 *
 * These are throwaway keys for a gasless test network, funded programmatically
 * by sim_fundAccount. The file is gitignored regardless.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, ".seed-state.json");

function load() {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch (err) {
    // NEVER start over here.
    //
    // This used to return {} on a parse failure, and `openState` calls save()
    // immediately - so an unreadable file was overwritten with an empty one on
    // the very next line. That destroyed the bidder keys and salts this file
    // exists to protect, which is the exact outcome the header above says must
    // not happen: a commitment whose salt is gone can never be opened, and its
    // deposit is forfeited on a round still holding an escrowed budget.
    //
    // A truncated file is usually recoverable by hand, so it is copied aside
    // before anything else touches it, and the run stops.
    const aside = `${FILE}.corrupt-${Date.now()}`;
    try {
      copyFileSync(FILE, aside);
    } catch {
      // If even the copy fails, refusing to run is still the right answer.
    }
    throw new Error(
      `${FILE} could not be parsed (${err.message}).\n` +
        `A copy was kept at ${aside}.\n` +
        `It holds the bidder keys and salts for sealed commitments on chain, so it is NOT\n` +
        `safe to start over: repair it, or if this address has no live sealed bids, delete\n` +
        `the file deliberately and re-run.`,
    );
  }
}

export function openState(address, fresh = false) {
  const all = load();
  const key = address.toLowerCase();
  if (fresh) delete all[key];
  const mine = all[key] || { address, done: [], salts: {}, keys: {}, rounds: {} };

  const save = () => {
    const current = load();
    current[key] = mine;
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(current, null, 2));
  };

  save();

  return {
    data: mine,
    save,
    isDone: (name) => mine.done.includes(name),
    markDone: (name) => {
      if (!mine.done.includes(name)) {
        mine.done.push(name);
        save();
      }
    },
    /** Remember a value once; later runs get the same one back. */
    remember: (bucket, name, make) => {
      if (mine[bucket][name] === undefined) {
        mine[bucket][name] = make();
        save();
      }
      return mine[bucket][name];
    },
    file: FILE,
  };
}
