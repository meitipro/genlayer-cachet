/**
 * The browser's commitment must equal the contract's.
 *
 *   node --test lib/seal.test.ts
 *
 * These digests were produced by the real `commitment_for` in
 * `contracts/cachet.py`, not by this file. That is the entire point: a test
 * that hashed the payload with the same TypeScript it is testing would agree
 * with itself while both halves drifted away from the chain.
 *
 * If one of these fails, every reveal on the site is refused. The contract
 * recomputes the digest from the revealed text and compares it against what
 * was committed, so a browser that hashes differently produces bids nobody can
 * ever open - and the deposit is forfeited for a mistake the bidder did not
 * make.
 *
 * The cases are chosen where two languages can plausibly disagree: multi-byte
 * characters, an embedded CRLF, tabs, an empty proposal, and address casing.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  commitmentFor,
  criteriaDigest,
  isHexDigest,
  newSalt,
  normaliseCriterion,
  sealPayload,
} from "./seal.ts";

const SALT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const ADDR = "0x84CE300C589A3D657F544FB3C16EA68D0B46414B";

/** name, salt, bidder, proposal, digest-from-contracts/cachet.py */
const FIXTURES: [string, string, string, string, string][] = [
  ["plain", SALT, ADDR, "A perfectly ordinary proposal about indexers.",
    "b46b1d11ebf9ec41e467fa6c772ad0d75f86ce1000b44794dc9a865c28fd730d"],
  ["newlines", SALT, ADDR, "line one\nline two\n\nline four",
    "6ea69002aaa7a5ca6b17fe2fcedc9c2796964d74a48b93a89275b6662c634c8f"],
  ["ascii", SALT, ADDR, "naive cafe, 12 EUR, resume attached",
    "935d744622c806dc8bf6abddf9af52f77161c16e0bd8647735c32f3ce3d64e32"],
  // Two-byte (ï, é) and three-byte (€) UTF-8 in one string: if the browser
  // ever encoded as anything but UTF-8, these are the characters that would
  // diverge first while plain ASCII kept agreeing.
  ["accents", SALT, ADDR, "naïve café - résumé €12",
    "b7f71b06078fc84ecc1847a24266f6b6b8ce76c8339023343b56f8ade6999853"],
  ["cjk", SALT, ADDR, "契約の提案書",
    "afcbe8c1fedb238a0c429ab57e8f917563f461884f011c9435f3e52f667554ab"],
  ["emoji", SALT, ADDR, "budget \u{1F512} sealed",
    "89ce29c3ccf937c0670eddeec89adfde4efc94ea7e732a86392654765533c06c"],
  ["empty", SALT, ADDR, "",
    "d481cc9b3598e60cf5aeab515d2e89cb5e46b038a70b2f57ccbbe0fddf4c9c2d"],
  ["lowercase address", SALT, ADDR.toLowerCase(), "casing must not matter",
    "6aae155b6d4eb8037fad906a823a15fae60aee6712a77444de884ea4eba39724"],
  ["tabs", SALT, ADDR, "col1\tcol2\tcol3",
    "c1817ed9b583a24e8a2d383f57a589fe4dc11e175266f8a999687e2a5495bd49"],
  ["crlf", SALT, ADDR, "windows\r\nline ending",
    "71ecf645895aa00e2a9ee09a7c75baa8437b14e25df5ad225f8df8efa2dc8f86"],
];

for (const [name, salt, bidder, proposal, expected] of FIXTURES) {
  test(`commitment matches the contract: ${name}`, async () => {
    assert.equal(await commitmentFor(salt, bidder, proposal), expected);
  });
}

test("address casing cannot change the commitment", async () => {
  // A wallet returns an EIP-55 checksummed address; the contract lowercases
  // before hashing. If this ever diverged, a bid sealed from a checksummed
  // address could never be opened.
  const a = await commitmentFor(SALT, ADDR, "same text");
  const b = await commitmentFor(SALT, ADDR.toLowerCase(), "same text");
  assert.equal(a, b);
});

test("the payload is exactly three newline-separated fields", () => {
  assert.equal(sealPayload("s", "0xAB", "p"), "s\n0xab\np");
  // A proposal containing newlines must not be able to look like extra fields
  // when read back - the contract splits nothing, it hashes the whole string.
  assert.equal(sealPayload("s", "0xAB", "a\nb"), "s\n0xab\na\nb");
});

test("a different salt gives a different commitment", async () => {
  const a = await commitmentFor(SALT, ADDR, "identical text");
  const b = await commitmentFor("00000000000000000000000000000000", ADDR, "identical text");
  assert.notEqual(a, b);
});

test("a different bidder gives a different commitment", async () => {
  // This is what stops a digest copied out of public state being opened by
  // whoever copied it.
  const a = await commitmentFor(SALT, ADDR, "identical text");
  const b = await commitmentFor(SALT, "0x0000000000000000000000000000000000000001", "identical text");
  assert.notEqual(a, b);
});

test("newSalt produces 32 fresh hex characters", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const s = newSalt();
    assert.match(s, /^[0-9a-f]{32}$/);
    assert.ok(!seen.has(s), "salts must not repeat");
    seen.add(s);
  }
});

/**
 * Criteria normalisation, against the contract's own digests.
 *
 * Every expected value below came from `normalise_criteria` /
 * `criteria_digest` in `contracts/cachet.py`. Three of these cases were live
 * bugs found by running the two implementations side by side: JavaScript's
 * `\s` and Python's `str.isspace()` are different sets, and `String.slice`
 * counts UTF-16 units where Python counts code points.
 *
 * A mismatch here does not show up as a wrong answer. It shows up as a buyer
 * who checks their criteria, gets a pass from the network, and then finds the
 * publish button will not light up - because the browser is looking for the
 * verdict under a digest the contract never wrote.
 */
const NORM: [string, string, string][] = [
  ["plain", "Relevant delivered work with references",
    "f383cfb919044e6c3cc0c6f45f2d4f0629d88fe0b9d9f29552decabe68451f09"],
  ["collapses runs of space", "  lots   of\t\tspace\n\nhere  ",
    "0028027537efd71f5192fac4d7afb7708f50d52860b883129b3b78aa6384afd0"],
  ["lowercases", "MiXeD CaSe CRITERIA",
    "7afc115832b938c8b34b4d6c0b5abc5a47b194e1c8e8bb4ed0f0c99dc6852d36"],
  ["splits on NBSP", "non breaking space",
    "08fa5727b4113776e12277768bcffd0c46c0073eb576d4f4b6a7f1db781b4a20"],
  // Python's str.isspace() covers U+0085; JavaScript's \s does not.
  ["splits on NEL U+0085", "nextline",
    "05d73f57af50719467c386925c37cb746341157e95805eb476672defa84d04be"],
  // The reverse: \s covers U+FEFF and Python does not, so a pasted BOM must
  // survive normalisation rather than being silently swallowed.
  ["keeps a BOM U+FEFF", "bom﻿inside",
    "b7eadc1ba0c75b07e4042ae64789bff59b90bd1378be6b8d6c3724b57aa8d649"],
  ["keeps a zero-width space", "zero​width",
    "cabb886dc821c97ba07fc5a80689433008db346ffb00ac2b8b514e9850abc249"],
  ["splits on ideographic space", "ideo　graphic",
    "487066df38470752578ddc85a7ecd04c226ccd347625743365157d590b109802"],
  // Truncation is by code point. String.slice(0, 160) would cut this at 80
  // emoji and could split a surrogate pair.
  ["truncates astral text by code point", "\u{1F512}".repeat(200),
    "3311a2afd36fb3618206e0031b1b12d5531379c421283a2bd9d20b9af1fc713f"],
  ["truncates ascii at 160", "x".repeat(200),
    "60ba0840031727513556758984811b638f10d19eff569b7ceeab609c72dbe193"],
  ["lowercases dotted capital I like Python", "İSTANBUL",
    "4a4df120f7d1f3c286f58651abfcec2aade892ace635f96f02b946c96e6e1f86"],
  ["applies the final-sigma rule like Python", "ΣΣΣ",
    "2cbae7151421581e15f48e2a0fc9bd9c3815740a4251e0f647997f33b3296c87"],
  ["splits on a vertical tab", "verticaltab",
    "27adf092b8630ca590bb485b3987cb81f5dddd6085741988001e792de7e5ef0a"],
  ["splits on a form feed", "formfeed",
    "8e47ed663e3c9b6d3486c7f88382b13719fbf44ac10d68b3e751c260cfdf6691"],
];

for (const [name, input, expected] of NORM) {
  test(`criteria digest matches the contract: ${name}`, async () => {
    assert.equal(await criteriaDigest([input]), expected);
  });
}

test("normaliseCriterion truncates by code point, never mid-surrogate", () => {
  const out = normaliseCriterion("\u{1F512}".repeat(200));
  assert.equal(Array.from(out).length, 160);
  // A cut through a surrogate pair would leave a lone surrogate behind.
  assert.ok(!/[\uD800-\uDFFF]$/.test(out.slice(-1)) || out.codePointAt(out.length - 2)! > 0xffff);
  assert.equal(out, "\u{1F512}".repeat(160));
});

test("criteria digest depends on order", async () => {
  // Order is part of the published standard: criterion 1 is the tie break.
  const a = await criteriaDigest(["first", "second"]);
  const b = await criteriaDigest(["second", "first"]);
  assert.notEqual(a, b);
});

test("isHexDigest accepts what the contract accepts", () => {
  assert.ok(isHexDigest("b46b1d11ebf9ec41e467fa6c772ad0d75f86ce1000b44794dc9a865c28fd730d"));
  assert.ok(!isHexDigest("b46b1d11"), "too short");
  assert.ok(!isHexDigest("B46B1D11EBF9EC41E467FA6C772AD0D75F86CE1000B44794DC9A865C28FD730D"), "uppercase");
  assert.ok(!isHexDigest("zz6b1d11ebf9ec41e467fa6c772ad0d75f86ce1000b44794dc9a865c28fd730d"), "not hex");
  assert.ok(!isHexDigest(""));
});
