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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, ".seed-state.json");

function load() {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    // A half-written file is not worth a crash: start over rather than refuse
    // to run at all.
    return {};
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
