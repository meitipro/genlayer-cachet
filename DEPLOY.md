# Publishing Cachet

Everything needed to take this from the repo to a running site, in order.
Each step says how to tell it worked, because a step that cannot be checked is
a step you will repeat.

Two things are worth knowing before you start:

- **Deploying a contract does not migrate anything.** A new address starts
  empty. Rounds, bids and scorecards live in the contract, so a redeploy is a
  fresh docket, not an upgrade.
- **The contract source and the site are versioned together.** `VERSION` in
  `contracts/cachet.py` is published by the `terms` view, and `npm run verify`
  refuses to check a deployment whose version does not match the repo. That is
  deliberate: an address on this project was once live while the source had
  moved two review passes ahead of it, and nothing on chain said so.

---

## 0. Once

```bash
npm install
```

Then check the whole thing offline, before spending anything on it:

```bash
npm test
```

418 checks across three suites: the contract driven as a state machine, its
pure helpers, and the browser-side hashing that has to agree with Python byte
for byte. All three must pass. If they do not, the deploy will not fix it.

Lint and validate the contract itself:

```bash
genvm-lint lint contracts/cachet.py
```

`genvm-lint validate` reports **"No contract class found"** on a normal
contract, because it skips the exact class name `Contract`, which is the
documented GenLayer shape. That is a bug in the linter and not in the contract.
To run it anyway, validate a copy with the class renamed.

---

## 1. Deploy

The deployer key is a real private key and never belongs in a file the repo
tracks. Set it in the shell for this session only:

```bash
$env:CACHET_DEPLOYER_KEY = "0x..."
```

```bash
npm run deploy -- --yes --fund
```

`--fund` tops the deployer up from Studio's faucet first. On a live network,
drop it and fund the account yourself.

**Expect the first attempt to fail.** The payload is about 103 KB and Studio
resets large request bodies, so genlayer-js reports `fetch failed` on
`eth_sendRawTransaction`. Eight attempts are made with a growing backoff and it
normally lands on the second. If all eight fail, deploy a tiny contract to tell
a size problem from an outage - that takes a minute and settles it.

The script prints the address. **Copy it exactly as printed.** `gen_call`
answers "Contract not found" for the all-lowercase form of a live contract, and
every page then reports that it could not read the chain, on a contract that is
running perfectly.

---

## 2. Check what you just deployed

```bash
npm run verify -- --address=0x...
```

Read-only, free, and it signs nothing, so it is safe against any address at any
time. Sixteen checks on an empty contract, more once rounds exist:

- the address answers, and its published `VERSION` matches this repo
- its published limits match the constants the site compiled against
- paging is sane, including the negative and past-the-end offsets that used to
  take the view down
- a round reads back with its criteria frozen and its digest well formed
- the bid counters on a round agree with the bids themselves
- an address that never bid reads as empty rather than as an error

If the version check fails, the rest is skipped: everything below it would be
checking a different contract.

---

## 3. Put a real tender through it

Optional, and worth it before anyone else sees the site: an empty docket makes
a poor first impression, and this proves the whole lifecycle on the contract
you just deployed rather than on the one that was tested last week.

```bash
npm run seed -- --address=0x... --yes --fund
```

It takes about fifteen minutes, because the windows are real windows on the
real clock. It is resumable - bidder keys, salts and completed steps are
written to `scripts/.seed-state.json` as they happen - so if it dies, run it
again and it continues.

What it proves, in order: the scorability gate refuses criteria that cannot be
scored from text; a reveal during the commit window is refused; a reveal that
does not match its seal is refused and stores nothing; a bidder who never
reveals forfeits the deposit; every revealed bid is scored per criterion; an
appeal re-scores; and the award goes to the highest weighted total.

Check it afterwards:

```bash
npm run status -- --address=0x...
```

---

## 4. Point the site at it

`.env.local` for local work:

```
NEXT_PUBLIC_CACHET_ADDRESS=0x...
NEXT_PUBLIC_GENLAYER_NETWORK=studionet
```

On Vercel, set the same two in the project's environment variables.

**Both are `NEXT_PUBLIC_`, which means they are inlined at BUILD time.**
Setting them in a hosting dashboard does nothing until the next deploy. If the
site still says no contract is configured after you set them, that is why.

Then:

```bash
npm run build
```

---

## 5. Check the site against the contract

```bash
npm run dev
```

Open it and confirm four things that only a browser can tell you:

1. **The landing paints immediately** - the seal animation is the first thing
   on screen, not a loading panel. The header's round count arrives a moment
   later and says "Reading the chain" until it does.
2. **The docket shows the rounds you seeded**, with the same numbers
   `npm run status` printed.
3. **A wallet connects.** The connect screen lists the EVM wallets actually
   installed in your browser, by their own names and icons. Pick one, approve
   the signature, and the header chip shows the address with its balance.
4. **The faucet credits.** Open the wallet menu and press it; the balance moves
   by the amount on the button. On a network without a programmatic faucet the
   button becomes a link to the real one.

---

## 6. Publish

Push, then deploy from Vercel. The repo has no secrets in it - `.env*`,
`scripts/.seed-state.json` and the deployer key are all gitignored - but check
rather than trust:

```bash
git diff --cached --name-only
```

and grep the staged diff for anything shaped like a key before the first push
of a session.

---

## Moving to a live network later

`NEXT_PUBLIC_GENLAYER_NETWORK=bradbury` switches the chain. Three things change
with it and the site already handles all three:

- **There is no programmatic faucet.** The wallet menu's faucet button becomes
  a link to the network's own faucet page.
- **Gas is real.** Studio charges none, so a round that costs nothing there
  costs something here.
- **A payout actually lands.** On Studio the award transfer is emitted
  correctly and the contract is debited, but the ledger does not credit an
  ordinary account, so a winner sees the award recorded and their balance
  unchanged. That is a property of the test network, and `/docs` says so.

Deploy a fresh contract on the new network, verify it, and update both
environment variables together. The address is network-specific; nothing
carries over.
