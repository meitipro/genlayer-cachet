import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * `/contract` claims to list every method on the contract. This checks that it
 * still does.
 *
 * It drifted once: `collect_forfeits` and `check` were added to the contract
 * and never reached the page, so a page whose whole purpose is to be an
 * honest inventory was quietly two methods short - and one of the two was a
 * method the publish screen calls on every run.
 *
 * Nothing here reads the chain. Both sides are source files, so this runs
 * anywhere and cannot be defeated by a deployment being unreachable.
 */

const CONTRACT = "contracts/cachet.py";
const PAGE = "app/(site)/contract/page.tsx";

/** The contract's public surface, taken from its decorators. */
function surface(): { writes: Set<string>; views: Set<string> } {
  const lines = readFileSync(CONTRACT, "utf8").split("\n");
  const writes = new Set<string>();
  const views = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const dec = lines[i].trim();
    if (!dec.startsWith("@gl.public.")) continue;
    // Skip any further decorators between this one and the def.
    let j = i + 1;
    while (j < lines.length && lines[j].trim().startsWith("@")) j++;
    const m = lines[j]?.trim().match(/^def ([a-z_0-9]+)\(/);
    if (!m) continue;
    (dec.startsWith("@gl.public.view") ? views : writes).add(m[1]);
  }
  return { writes, views };
}

/** The two arrays the page renders, read separately so a count can be wrong. */
function listed(): { writes: string[]; views: string[] } {
  const page = readFileSync(PAGE, "utf8");
  const grab = (name: string) => {
    const block = page.match(new RegExp(`const ${name}: Method\\[\\] = \\[([\\s\\S]*?)\\n\\];`));
    assert.ok(block, `${PAGE} no longer declares ${name}`);
    return [...block[1].matchAll(/name:\s*"([a-z_0-9]+)"/g)].map((m) => m[1]);
  };
  return { writes: grab("WRITES"), views: grab("READS") };
}

test("the contract page lists every write, and invents none", () => {
  const { writes } = surface();
  const page = listed().writes;
  const missing = [...writes].filter((n) => !page.includes(n)).sort();
  const invented = page.filter((n) => !writes.has(n)).sort();
  assert.deepEqual(missing, [], `writes missing from ${PAGE}`);
  assert.deepEqual(invented, [], `writes on ${PAGE} that the contract does not have`);
});

test("the contract page lists every view, and invents none", () => {
  const { views } = surface();
  const page = listed().views;
  const missing = [...views].filter((n) => !page.includes(n)).sort();
  const invented = page.filter((n) => !views.has(n)).sort();
  assert.deepEqual(missing, [], `views missing from ${PAGE}`);
  assert.deepEqual(invented, [], `views on ${PAGE} that the contract does not have`);
});

test("the page lists each method once, so its printed count is true", () => {
  const { writes, views } = listed();
  assert.equal(new Set(writes).size, writes.length, "a write is listed twice");
  assert.equal(new Set(views).size, views.length, "a view is listed twice");
});

test("the page lists each method's arguments in the contract's order", () => {
  // `reveal` was published as (round_id, bid_index, proposal, salt) while the
  // contract takes (round_id, bid_index, salt, proposal). Anyone calling it
  // from the documented order gets ERR_BAD_SALT during a closing window, and
  // the page is the only thing that told them wrong.
  const src = readFileSync(CONTRACT, "utf8");
  const page = readFileSync(PAGE, "utf8");

  const real = new Map<string, string[]>();
  for (const m of src.matchAll(/^\s*def ([a-z_0-9]+)\(self,?([^)]*)\)/gm)) {
    const args = m[2]
      .split(",")
      .map((a) => a.trim().split(":")[0].trim())
      .filter(Boolean);
    real.set(m[1], args);
  }

  const mismatched: string[] = [];
  for (const m of page.matchAll(/name:\s*"([a-z_0-9]+)",\s*\n?\s*args:\s*"([^"]*)"/g)) {
    const [, name, argString] = m;
    const listed = argString.split(",").map((a) => a.trim()).filter(Boolean);
    const actual = real.get(name);
    if (!actual) continue; // covered by the existence tests above
    // Only compare where the page names the real parameters rather than
    // summarising them, as `open_round` deliberately does.
    if (listed.length !== actual.length) continue;
    if (listed.join(",") !== actual.join(",")) {
      mismatched.push(`${name}: page says (${listed.join(", ")}), contract takes (${actual.join(", ")})`);
    }
  }
  assert.deepEqual(mismatched, [], "argument order differs from the contract");
});

test("the README's method count is the real one", () => {
  // It said "29 methods, 10 view and 19 write" while the contract had 30. A
  // README is the first thing a reader checks the project against, so a count
  // that is quietly one short is worse there than anywhere else.
  const { writes, views } = surface();
  const readme = readFileSync("README.md", "utf8");
  const m = readme.match(/(\d+) methods?, (\d+) view and (\d+) write/);
  assert.ok(m, "README no longer states a method count in the expected shape");
  const [, total, nViews, nWrites] = m.map(Number) as unknown as number[];
  assert.equal(nViews, views.size, "README view count");
  assert.equal(nWrites, writes.size, "README write count");
  assert.equal(total, views.size + writes.size, "README total");
});

test("the README's check count adds up to its own parts", () => {
  // "428 checks: 41 browser, 244 pure helpers, 143 ..." was true and then was
  // not, because adding a test file changes the browser half and nothing makes
  // the sentence notice. It went stale twice in one sitting.
  //
  // This checks the total against its own parts, which is the error that
  // actually happened both times: a part was updated and the total was not, or
  // the reverse. It deliberately does NOT try to count the real tests. A static
  // count of `test(` gives 32 against a run that reports 56, because two of
  // these files drive their cases from tables and subtests - so a check built
  // on that number would fail honestly-written tests and teach everyone to
  // ignore it. The three real totals are printed by `npm test` on every run.
  const readme = readFileSync("README.md", "utf8");
  const m = readme.match(
    /(\d+) checks: (\d+) browser, (\d+) pure helpers, (\d+) driving the contract/,
  );
  assert.ok(m, "README no longer states the check breakdown in the expected shape");
  const [, total, ui, helpers, state] = m.map(Number) as unknown as number[];
  assert.equal(
    total,
    ui + helpers + state,
    `README says ${total} checks but its own parts add to ${ui + helpers + state}`,
  );

  // The same three numbers are written in two other places, and all three have
  // now gone stale independently. Tie them together so one edit cannot leave
  // the others behind.
  const fileMap = readme.match(/test_helpers\.py\s+(\d+) checks[\s\S]*?test_contract\.py\s+(\d+) checks/);
  assert.ok(fileMap, "README no longer states per-suite counts in its file map");
  assert.equal(Number(fileMap[1]), helpers, "README file map disagrees with its own command table");
  assert.equal(Number(fileMap[2]), state, "README file map disagrees with its own command table");

  // DEPLOY.md is gitignored, so it is only checked when it is present.
  let deploy = "";
  try {
    deploy = readFileSync("DEPLOY.md", "utf8");
  } catch {
    return;
  }
  const dm = deploy.match(/(\d+) checks across three suites/);
  assert.ok(dm, "DEPLOY.md no longer states a total in the expected shape");
  assert.equal(Number(dm[1]), total, "DEPLOY.md total disagrees with the README");
});

test("every method the site calls exists on the contract", () => {
  const { writes, views } = surface();
  const all = new Set([...writes, ...views]);
  const files = [
    "components/PublishForm.tsx",
    "components/SealPanel.tsx",
    "components/Clarifications.tsx",
    "components/WalletChip.tsx",
    "lib/cachet.ts",
  ];
  const called = new Set<string>();
  for (const f of files) {
    let text = "";
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue; // a renamed screen is not this test's business
    }
    for (const m of text.matchAll(/functionName:\s*"([a-z_0-9]+)"/g)) called.add(m[1]);
  }
  assert.ok(called.size > 0, "found no contract calls at all, so this test proved nothing");
  const phantom = [...called].filter((n) => !all.has(n)).sort();
  assert.deepEqual(phantom, [], "the site calls a method the contract does not have");
});
