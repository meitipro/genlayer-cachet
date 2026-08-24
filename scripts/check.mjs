#!/usr/bin/env node
/**
 * genvm-lint, run so that it actually reports what it found.
 *
 * Two things make the raw CLI misleading on a real contract:
 *
 *   1. `genvm-lint validate` skips a class literally named `Contract`
 *      (validate/sdk_loader.py), which is the GenLayer convention, so every
 *      real contract reports "No contract class found". This copies the file
 *      to a temp path with the class renamed before validating.
 *   2. `genvm-lint check` runs lint AND validate and exits non-zero on either,
 *      so a genuine lint error is invisible in the noise. Lint and validate
 *      are run and reported separately here.
 *
 * On Windows PYTHONIOENCODING has to be utf-8 or the linter dies with a
 * UnicodeEncodeError while printing its own success tick, and pass is
 * indistinguishable from fail.
 *
 *   node scripts/check.mjs              lint only
 *   node scripts/check.mjs --validate   lint, then validate + schema
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FILES = ["contracts/cachet.py"];
const withValidate = process.argv.includes("--validate");
const env = { ...process.env, PYTHONIOENCODING: "utf-8" };

function run(args) {
  const res = spawnSync("genvm-lint", args, { encoding: "utf8", env, shell: true });
  return {
    ok: res.status === 0,
    out: `${res.stdout || ""}${res.stderr || ""}`.trim(),
  };
}

let failed = false;

for (const file of FILES) {
  const lint = run(["lint", file]);
  console.log(`\n=== lint ${file} ===\n${lint.out}`);
  if (!lint.ok) failed = true;

  if (!withValidate) continue;

  const dir = mkdtempSync(join(tmpdir(), "cachet-validate-"));
  try {
    const renamed = join(dir, "contract.py");
    writeFileSync(
      renamed,
      readFileSync(file, "utf8").replace(
        /^class Contract\(gl\.Contract\):/m,
        "class CachetContract(gl.Contract):",
      ),
    );
    for (const cmd of ["validate", "schema"]) {
      const res = run([cmd, renamed]);
      console.log(`\n=== ${cmd} ${file} ===\n${res.out}`);
      if (!res.ok) failed = true;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failed ? "\nFAILED" : "\nOK");
process.exit(failed ? 1 : 0);
