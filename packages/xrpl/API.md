# @xrlp/xrpl — API

All XRPL devnet ledger operations for the project. Every tx-submitting call waits for validation,
throws `XrplTxError` (with the engine result + explorer link) unless `tesSUCCESS`, and returns
`TxResult { hash, explorerUrl, result, tx, meta }` and/or a shared `ChainEvent`.

```bash
pnpm --filter @xrlp/xrpl bootstrap      # fund + configure demo wallets + credentials -> $WALLETS_FILE (default .data/wallets.json, gitignored); idempotent
                                        #   flags: --fresh  --no-credentials  --pre-verify-builder  --platform-rlusd=N (or BOOTSTRAP_PLATFORM_RLUSD)
pnpm --filter @xrlp/xrpl demo           # full money path on devnet, prints a tx table with explorer links
pnpm --filter @xrlp/xrpl test           # offline unit tests (condition encoding, lending math, wallet-file migration)
pnpm --filter @xrlp/xrpl spike:broker   # XRPL-04 devnet proof: rates, mandatory cover, origination fee
pnpm --filter @xrlp/xrpl spike:close    # XRPL-06 devnet proof: LoanSet + 3 escrows, SPV liquid = 0, bad input refused with nothing submitted
pnpm --filter @xrlp/xrpl spike:default  # XRPL-15 devnet proof: impair / unimpair / default, first-loss cover absorbs DefaultCovered (~5 min)
pnpm --filter @xrlp/xrpl spike:batch  # XRPL-13 devnet proof: Batch sanity, all-or-nothing rollback, full close (LoanSet inner) probe, closeLoanAtomic "auto" (~3 min; SPIKE_SUBSCRIPTION_S=30 to shorten)
pnpm --filter @xrlp/xrpl spike:close-batch  # XRPL-13b devnet proof: escrows in ONE all-or-nothing Batch; rollback + partial close → resumeEscrowCreation (~8 min)
pnpm --filter @xrlp/xrpl compliance     # XRPL-08 devnet proof: credentials x3, domain, private vault, fee, attestations
pnpm --filter @xrlp/xrpl capture:reads  # re-record test/fixtures/*.json from fresh devnet objects (~2 min)
pnpm --filter @xrlp/xrpl stress         # devnet: 20 parallel Payments from one account, all tesSUCCESS
pnpm --filter @xrlp/xrpl stress --pipeline  # XRPL-17 devnet: same burst locked vs pipelined (speedup); --multisig --foreign --held --window=N
pnpm --filter @xrlp/xrpl spike:release  # XRPL-07 devnet proof: finish, wrong fulfillment, repay, cancel+refund, withdraw (~7 min)
pnpm --filter @xrlp/xrpl adapter:e2e    # XRPL-10 devnet: XrplLedgerAdapter through the whole LedgerPort flow (~7 min)
pnpm --filter @xrlp/xrpl spike:fail-hard  # security review H1b devnet proof: a held terPRE_SEQ tx applies later unless fail_hard (~1 min)
pnpm --filter @xrlp/xrpl typecheck
```

Scripts set `NODE_USE_ENV_PROXY=1` so faucet `fetch` honours `HTTPS_PROXY`; the websocket gets an
`https.Agent({ proxyEnv })` when `HTTPS_PROXY` is set. Without a proxy, nothing changes.

## Protocol facts that shape the API (devnet, rippled 3.4.1, verified 2026-10-24)

- **`LendingProtocolV1_1` is enabled on devnet.** `LoanBrokerSet` only works on a **closed-ended vault**
  (`VaultKind=1`, `SubscriptionDate`, `RedemptionDate`, with Redemption − Subscription ≥ 180s).
  Phases come from ledger close time:
  - **Subscription** (`now <= SubscriptionDate`): `VaultDeposit` OK. `LoanSet` fails with `tecTOO_SOON`.
  - **Investment**: `LoanSet` OK. Deposits **and withdrawals** are blocked.
  - **Redemption** (`now >= RedemptionDate`): `VaultWithdraw` OK again, no deposits.
  - `LoanSet` also requires `StartDate + PaymentInterval×PaymentTotal + 60 <= RedemptionDate`.
  - Mapping: Subscription end = `terms.fundingDeadline`. Redemption = end of the loan term plus a buffer.
- **`fixCleanup3_4_0` is enabled**, so counterparty signatures use the dedicated signing prefixes. xrpl.js
  5.3.0's `signLoanSetByCounterparty` / `combineLoanSetCounterpartySigners` already does this.
- **`LoanPay` minimum = one periodic payment** (amortized: principal/N + interest). A smaller amount fails
  with `tecINSUFFICIENT_PAYMENT`, and a balance that can't cover it fails with `tecINSUFFICIENT_FUNDS`.
  `tfLoanOverpayment` (needs `tfLoanOverpayment` on `LoanSet`, which we set by default) lets a payment
  larger than the periodic amount pay principal down early.
- **IOU escrows (TokenEscrow)**: the issuer needs `asfAllowTrustLineLocking`, and `CancelAfter` is required.
  Escrows created by a multisig SPV still use the SPV's `Sequence` as `OfferSequence`.
- **Vault shares**: for an IOU vault, shares (MPT) are 10^6 per 1 RLUSD at the start, e.g. 10000 RLUSD →
  `10000000000` shares.

## Submission semantics (XRPL-12)

Every submit goes through `src/submit.ts` (pure retry engine, offline-tested) via `client.ts`:

- **Per-account lock.** `signAndSubmit` / `submitWithSigner` hold `withAccountLock(Account)` across
  autofill → sign → submit → wait-for-validation, so concurrent calls for one account never race on `Sequence`.
  Different accounts run in parallel. Cost: one account does about one tx per ledger (~4–6s on devnet).
  The lock is **re-entrant** in the same async chain. `submitBlob` locks on the blob's `Account` too.
- **Pre-signed / multisig paths (owners of `loan.ts`, `spv.ts`, `escrow.ts`).** If you autofill yourself and then call
  `submitBlob`, wrap the whole thing so nothing else from that account slips between autofill and submit:
  `withAccountLock(tx.Account, async () => { const p = await client.autofill(tx); …; return submitBlob(blob, type); })`.
  For multisig the better option is `submitWithSigner(account, {...tx, SigningPubKey: ""}, (p) => multisign(signers.map((w) => w.sign(p, true).tx_blob)), { signersCount: signers.length })`.
  You get the lock and full retries, re-signing included.
- **`LastLedgerSequence` is always set**: validated index + `lastLedgerMargin` (default `DEFAULT_LLS_MARGIN` = 20, env
  `XRPL_LLS_MARGIN`). Pass `{ lastLedgerMargin: 60 }` for txs that may take longer (EscrowFinish). Margins must be an
  integer in 1..500 (`MAX_LLS_MARGIN`, `assertLlsMargin`; a bad `XRPL_LLS_MARGIN` refuses to load): "provably not applied"
  is a ranged `tx` lookup, and rippled searches at most 1000 ledgers at once.
- **`fail_hard: true` on every submit** (`submitRequest`). Without it rippled holds a locally submitted tx whose
  provisional result is `ter*` / `tel*` / `tef*` (except `tefPAST_SEQ`) and re-applies it at later ledgers, so a "refused"
  blob could still apply after a re-sign (security review H1b; devnet proof `pnpm --filter @xrlp/xrpl spike:fail-hard`).
  One exception: under `fail_hard` rippled answers a `tec*` but **discards** it (no fee, Sequence untouched, not relayed),
  so an intended on-ledger failure (wrong fulfillment, `tecNO_AUTH` deposit, `tecTOO_SOON`) would never land. The engine
  resubmits that **same blob** once without `fail_hard` (same hash, so it applies at most once; still under the account
  lock / pipeline mutex) and from then on tracks it as maybe-applied whatever the answer (it may now be held or relayed).
  If that resubmit is refused by the RPC layer, the error keeps the `tec*` code (`onLedger: false`, non-retriable).
- **Retries are bounded** (`maxAttempts` default 5, exponential backoff 0.5s → 4s):

  | Preliminary / error | Action |
  |---|---|
  | `tesSUCCESS`, `terQUEUED`, `tefALREADY`, other `ter*`, `tec*` | wait for the validated result (`tec*` final → throw, never retried; a `tec*` from the `fail_hard` submit is first resubmitted as the same blob without `fail_hard`, see above) |
  | `telINSUF_FEE_P`, `telCAN_NOT_QUEUE*`, RPC `tooBusy`/`noNetwork`/`noCurrent`/`slowDown` | back off, re-sign with the **same Sequence** and a fresh Fee (pre-signed blob: resubmit the same blob) |
  | websocket disconnect / timeout | reconnect the shared client, resubmit the **same blob** (same hash, so it's idempotent) |
  | `LastLedgerSequence` passed and `tx` reports `searched_all` with no hit | provably not applied → re-sign with the same Sequence (pre-signed: throw `retriable`) |
  | `tefPAST_SEQ` | if this hash may have been sent earlier in this call, wait for it. Otherwise look its own hash up: validated → that is the result. Not validated (rippled's cache answers "known, not validated" for the refused blob itself): a blob the engine signed in this call (`submitWithSigner`) is dead at once; a pre-signed blob (`submitBlob`, may have an earlier history) is decided from account state (who used the Sequence: ours → its result; another tx → dead). Then wait out every **earlier** blob of this intent that may have been sent, and re-autofill a fresh Sequence (pre-signed: throw `retriable`) |
  | `tem*`, other `tef*`/`tel*` | throw, never retried (after waiting out earlier blobs of the intent that may still apply) |
  | `tx` lookup fails while waiting (not a connection error) | `tooBusy`-style errors are polled through; anything else → `unknown_outcome` |
  | past `LastLedgerSequence` the lookup says "known, not validated" (rippled's cache), or no new validated ledger for `maxWaitMs` | bounded, then `unknown_outcome` (never an unbounded wait under the account lock) |

  A new blob is only signed after the old one provably **cannot** apply. Same-Sequence re-signs are mutually exclusive
  with the original, so there is no double spend. A validated hash is never resubmitted. Every blob that may have reached a
  server stays tracked until it validates or provably expires (security review H1): a fresh Sequence is signed, and a
  retriable or definite failure thrown, only once all of them are settled.
- **Errors.** `XrplTxError { txType, engineResult, hash?, explorerUrl?, retriable }` (the constructor is backwards
  compatible). `retriable` is true only when **no blob of the intent can still apply** (each was refused, or provably
  expired), so rebuilding from scratch is safe; after a lost connection that was then proven expired the engine result is
  `not_applied`. An unknown outcome is never retriable: `connection_lost` (socket down 6 times) or `unknown_outcome`
  (history incomplete, lookup failed, a re-sign failed while an earlier blob may apply), both with the hash to look up
  (security review H2). Error `cause`s are redacted copies: xrpl.js echoes the signed blob (for an EscrowFinish, the
  fulfillment) in `TimeoutError` messages and `RippledError.data.request` (`redactedCause`, `redactSecrets`; M3).
  `toErrorCode(e)` maps to the shared `ErrorCode` (`@xrlp/shared`; `ApiErrorCode` is a deprecated alias): a shared
  `LedgerError` keeps its `code`; preflight refusals (`UnsafeReleaseError`, a refused `PreflightResult`, an
  `unsafeReleaseError()` body) → `unsafe_release`; `tecTOO_SOON → too_soon`,
  `tecNO_ENTRY/tecNO_TARGET/tecNO_DST/tecOBJECT_NOT_FOUND/tecNO_LINE`, plus RPC `entryNotFound`/`actNotFound`/`txnNotFound`/`objectNotFound`
  → `not_found`, `tem* → validation`, everything else `ledger_error`.
- **LedgerPort errors (shared v2).** `toLedgerError(e)` turns anything this package throws into the shared
  `LedgerError` the `LedgerPort` must throw: `LedgerError`s (incl. `TooSoonError`, `UnsafeReleaseError`) pass through;
  `XrplTxError` `tecTOO_SOON` → `TooSoonError`, other `XrplTxError` → `LedgerError("ledger_error")`, both with
  `txResult` (engine result) and `txHash` (when it reached a ledger); a refused preflight → `LedgerError("unsafe_release")`;
  anything else → `LedgerError("ledger_error", message)`. The original error is `cause`. `withLedgerErrors(fn)` wraps an
  adapter method: `return withLedgerErrors(() => depositToVault(...))`.
- `XRPL_SUBMIT_LOG=1` prints every retry decision with its explorer link.

**Devnet proof** (`pnpm --filter @xrlp/xrpl stress`, 2026-10-24, fresh faucet wallets): 20 parallel RLUSD `Payment`s
from one account → **20/20 `tesSUCCESS`**, Sequences 6390192..6390211 contiguous, 0 retries, 128.6s.
Same burst via raw xrpl.js `autofill`+`submitAndWait` (`STRESS_BASELINE=1`) → 1 `tesSUCCESS`, **19 `tefPAST_SEQ`**.
First/last: https://devnet.xrpl.org/transactions/93F70A01CAA36E7A6B318B61B31C52313AD8B8C7BFAF484C6804BFA1A29CD79F ·
https://devnet.xrpl.org/transactions/AB03F78A5862CCC25B601DB65368FBEF1D839A7914D743D0F6282DD52ADA2EBC

### Pipelined mode (XRPL-17, opt-in)

Off by default; everything above is unchanged. Turn it on with `XRPL_PIPELINE=1` (window `XRPL_PIPELINE_WINDOW`, default
5, max 10) or `setSubmitMode("pipelined", { window })`; `setSubmitMode("locked")` / `resetSubmitMode()` switch back.
Txs already in flight finish the way they started.

- **What changes.** `signAndSubmit` / `submitWithSigner` / `submitMultisigned` hold the account lock only across
  autofill → sign → submit. `Sequence` comes from a local per-account counter (read from `account_info` current +
  `queue`, re-read whenever the account goes idle), and up to `window` txs per account wait for validation at the same
  time. Same `TxResult`, same `XrplTxError`s, `LastLedgerSequence` always set (`lastLedgerMargin` per call). Multisig
  (`SigningPubKey ""`) is just another `sign` callback.
- **What keeps locked semantics.** Explicit `withAccountLock` sections (`loanSet`, `submitBatch` / every Batch,
  `closeLoanAndCreateEscrows`, `resumeEscrowCreation`), every `submitBlob` (pre-signed blobs keep their own Sequence; a
  conflict surfaces as their error, e.g. `tefPAST_SEQ` with `retriable: true`), and txs that set `Sequence` /
  `TicketSequence`. Such a section first waits for the account's in-flight txs to settle; the counter is re-read after.
  So those call sites did not change.
- **Rules** (`src/submit.ts` R1–R6; each one has a test in `test/pipeline.test.ts`, plus a randomized test of drops,
  tem/tel, disconnects, foreign writers, delays and tec that checks nothing ever applies twice: 75 runs by default,
  `CHAOS_SEEDS=2000` soaks 6 000, which passed):
  - The counter only advances when the server took the blob. A `tem`/`tef`/`tel` at submit leaves no gap: the next tx
    reuses that Sequence.
  - `tec*` (Sequence consumed, later txs unaffected) and `tem*` are final, never retried. A `tec*` discarded by
    `fail_hard` is resubmitted as the same blob without it while the mutex is still held (nothing later signed yet), and
    then counts as sent whatever it answered; only account state can call it dead.
  - Same-Sequence re-signs (`tel*`, expiry at submit) are always safe. A tx gets a **different** Sequence only after
    every blob it may have sent is provably dead. A `tel*` blob counts as sent: rippled may hold and retry it until
    its `LastLedgerSequence` (xrpl.org: tel results are provisional).
  - **"Provably dead" comes from account state, not from `tx`.** rippled answers `tx` for any blob it has seen with
    `validated: false` (never `txnNotFound` + `searched_all`) for as long as it stays cached, so that proof never fires
    (devnet, protocol notes §0a). Once the validated ledger reaches the blobs' LastLedgerSequence L: the account's
    Sequence in ledger L ≤ S → none applied. If it's > S, `account_tx` names the tx that used S: ours → that's the
    result; another → ours are dead. If neither is known yet, wait (bounded), then `unknown_outcome`.
  - `tefPAST_SEQ` (another writer used our Sequence), `terPRE_SEQ` (a gap before us), or a tx that died unapplied
    (later txs stall behind it) marks the account **dirty**. Nothing new is issued, every in-flight tx settles, the
    counter is re-read, and only the dead txs are re-signed, in their original order.
  - `unknown_outcome` / `connection_lost` while a blob may be out: never re-signed, and the account resyncs first.
    Once nothing of the tx can apply, a lost connection is `not_applied` with `retriable: true` (as in `submitReliably`).
  - `tooBusy` lookups are polled through; any other lookup error → `unknown_outcome`. Error causes are redacted
    (security review M3). A throwing `onRetry` / `onPipeline` callback can't break the engine.
- **Where it helps.** Concurrent submits from one account: core serving several requests the platform signs,
  `Promise.all` of independent txs. A chain of awaited txs (prestage, the CLI demo) still waits about one ledger per tx.
  That wait is validation, not the lock (timings below).
- `XRPL_SUBMIT_LOG=1` also prints `⚠ pipeline … → draining` and `⟳ … resync` lines. `pipelineState(account)` shows the
  counter and the in-flight / parked txs.

**Devnet proof** (`pnpm --filter @xrlp/xrpl stress --pipeline`, 2026-10-25, fresh faucet wallets, window 5): 20 parallel
RLUSD `Payment`s from one account, the same burst locked and then pipelined:

| run | locked | pipelined | speedup | ledgers used, pipelined vs locked |
|---|---|---|---|---|
| 1: 4 round trips under the lock, 1 s polls | 93.9 s | 24.6 s | 3.8× | 7 vs 20 (spread over 28) |
| 2: Fee and validated index fetched in parallel | 103.5 s | 26.0 s | 4.0× | 6 vs 20 (over 31) |
| 3: one shared validated-ledger watcher | 108.1 s | **21.8 s** | **5.0×** | 6 consecutive vs 20 (over 33) |
| 4 (final code: account-state proof, tel* tracked) | 107.8 s | 27.3 s | 3.9× | 7 consecutive vs 20 (over 32) |

Every burst: 20/20 `tesSUCCESS`, contiguous distinct Sequences, 0 retries. Devnet closes a ledger every ~3.2–3.3 s, and
locked mode needs ~1.6 ledgers per tx. Runs 3 and 4 differ only by devnet timing (how refills straddle a close, plus
start-up), not by ledgers used per tx. Run 3 pipelined first/last:
https://devnet.xrpl.org/transactions/505E5C878A7A8F90D2163CC106D5ADB947F23160DFC7ED8CC3AE21D8CB597B69 ·
https://devnet.xrpl.org/transactions/35609C7199A951971CCEDF8376D80100D2EA477504A18D95B12CAE9A2CA52647

`stress --pipeline-only --foreign --multisig` (`XRPL_SUBMIT_LOG=1`): a raw Payment from the same account took the
pipeline's next Sequence, 6395951
(https://devnet.xrpl.org/transactions/9B7AFC1C84824A4D0939ED5E7E61C918D6DA51BFBEB94C607583B9B8340162AE). Our next submit
got `tefPAST_SEQ` (nothing applied) → dirty → resync to 6395952 → 5 txs re-signed
(https://devnet.xrpl.org/transactions/42DD30CFAE74F620DF31FAC7208C6AE57E24551DF9A8F85EC438FD0E19BCE3F8) → 20/20 in
21.3 s. 20 pipelined **multisig** Payments (2-of-3 SignerList, `SigningPubKey ""`) → 20/20 in 23.0 s:
https://devnet.xrpl.org/transactions/DEF7CBB8D06E80329EFCB7FFD04DBA300132B5456DC3B3C0D042F25C57E4C0A0 ·
https://devnet.xrpl.org/transactions/F61816F839639197F68DDCCCEA7FB1ABEB9A41090DDD7A9E50919705146616C2

`stress --held`: one pipelined Payment whose first blob was signed a Sequence ahead (a stale counter) → `terPRE_SEQ`,
held by the server. Past its LastLedgerSequence (6397098) `tx` still answered "not validated", while the account's
Sequence in that ledger, 6397084 ≤ 6397085, proved it dead → resync → re-signed at 6397084 → `tesSUCCESS` in 21.7 s
(https://devnet.xrpl.org/transactions/66E83AFF9AC1DBDCF8E69E845CDF3DC8C849CFE9D8E19A823A5D1772A3BD58F5), and
`txWithSequence` named that same tx.

**Prestage** (`prestage --only A`, same wallets, back to back): locked 123 s · `XRPL_PIPELINE=1` 123 s · locked 132 s.
No gain, as expected: the script awaits each of its ~20 txs and waits ~30 s for the vault's SubscriptionDate. The
pipelined run still went end to end with every step green: multisig SPV txs, the countersigned `LoanSet`
(https://devnet.xrpl.org/transactions/A4DEEE8736BD262EC5979591CCDC3660297EEF2903AE394619DAFC50CAEEE929) and the escrow
Batch (https://devnet.xrpl.org/transactions/45C65FF7280A468B61412D6FE9E1715C0C3B192E8F50627A34D0BB3448926DF0) through
their exclusive lock sections.

## High-level API (what `@xrlp/core` calls)

Wallet arguments (`WalletRef`) accept a role name (`"investor1"`), a demo address from
`.data/wallets.json`, or an xrpl `Wallet`.

### Roles (Direction v2, `WALLET_ROLES`)

| Role | RLUSD trust line | Bootstrap RLUSD | Bootstrap credential | Used for |
|---|---|---|---|---|
| `issuer` | — (issuer) | — | — | mock RLUSD; `DefaultRipple` + `AllowTrustLineLocking` |
| `platform` | ✔ | 25 000 (`platformRlusd`, `DEFAULT_PLATFORM_RLUSD`) | issuer of all credentials | vault + broker owner, first-loss cover, credential issuer, receives verification fees, SPV signer |
| `releaseService` | — | — | — | submits `EscrowFinish` / `EscrowCancel`, `release` attestations (XRP fees only) |
| `builder` | ✔ | 1 000 (`builderRlusd`, ≥ 250 fee) | — (`VERIFIED_BUILDER` is earned via project verification; `preVerifyBuilder` for prestage) | pays verification fee, receives milestone payouts, SPV signer |
| `investor1..3` | ✔ | 50 000 each (`investorRlusd`) | `KYC_INVESTOR` for investor1 + investor2, accepted. **investor3: none** (bootstrap deletes a stray one) → `tecNO_AUTH` on the private vault | vault depositors |
| `inspector1..3` | — | — | `VERIFIED_INSPECTOR`, accepted | panel; audit attestations (1-drop XRP); the project's assigned one is an SPV signer (default `inspector1`) |
| `aiAgent` | — | — | — | verdict attestations; **not** an SPV signer |
| `trustee` | — | — | — | 4th SPV signer (investor rep) |

Trust lines only for `RLUSD_HOLDERS` (`platform, builder, investor1..3`); add a role there if it must ever hold RLUSD.
Bootstrap is idempotent: it reuses `WALLETS_FILE`, generates only missing roles, renames v1 roles
(`inspectorA → inspector1`, `inspectorB → inspector2`, same account), moves unknown roles to `retired` (seeds kept),
tops up XRP below 30, skips existing issuer flags / trust lines, mints only up to the targets, and grants credentials via
the idempotent `grantCredential` (`credentialPlan()`; `NO_KYC_ROLES = ["investor3"]`). A second run submits 0 txs.

**Platform RLUSD budget.** The platform posts the mandatory first-loss cover for every project (≈ 11% of principal:
`defaultCoverDeposit` = 10% of principal + interest, +10% headroom); fees are XRP. `DEFAULT_PLATFORM_RLUSD = 25 000` covers
3 concurrent projects (prestage A/B/C) of up to ~68 000 principal each on demo terms (10% APR, 30 days), more than the
150 000 the investors hold in total. For other sets use `platformRlusdFor(terms[])` (sum of covers +10% slack, rounded up
to 1 000), e.g. `bootstrapWallets({ platformRlusd: platformRlusdFor([a.terms, b.terms, c.terms]) })`. Bootstrap tops
the platform back **up** to the target, so after cover deposits a re-run mints the difference (not 0 txs).

**Devnet proof** (2026-10-24, fresh `WALLETS_FILE`): run 1 = 22 txs: 2 issuer `AccountSet`, 5 `TrustSet`, 5 RLUSD `Payment`,
5 × `CredentialCreate` + `CredentialAccept` (e.g. investor1 KYC
https://devnet.xrpl.org/transactions/90AC90D381DF16E4FBA72F8F01EE2A8DC8CF89C79D4AD5707FE5BC500C4CE675). Run 2 = **0 txs**.
A stray investor3 KYC is removed on the next run
(https://devnet.xrpl.org/transactions/F3B4FBA6E7664DA06306D70F0175B6C7FFABC04087DC9588F0AE59A01F67A9D3), then 0 txs again.

| Function | Txs | Returns |
|---|---|---|
| `bootstrapWallets({fresh?, investorRlusd?, platformRlusd=25000, builderRlusd?, credentials=true, preVerifyBuilder=false, log?})` | faucet, issuer `AccountSet` (DefaultRipple, AllowTrustLineLocking), `TrustSet`s (RLUSD holders), RLUSD `Payment`s, `CredentialCreate` + `CredentialAccept` (KYC_INVESTOR investor1/2, VERIFIED_INSPECTOR inspector1..3, VERIFIED_BUILDER builder if `preVerifyBuilder`), `CredentialDelete` of a stray investor3 KYC | `{wallets, txs, credentials: [{role, type, status}]}` (idempotent, 2nd run `txs = []`) |
| `setupProjectOnChain(project, {subscriptionEndsAt?, redemptionAt?, paymentTotal?, paymentIntervalS?, coverDeposit?, coverRateMinimum?, coverRateLiquidation?, managementFeeRate?, lockSpv=true, spvSigners?: {builder?, inspector?, platform?, trustee?}})` | SPV faucet + `TrustSet`, `SignerListSet` {platform, builder, inspector, trustee} w1 quorum 3, `AccountSet asfDisableMaster`, `VaultCreate` (closed-ended, `AssetsMaximum = principal`), `LoanBrokerSet` (cover rates + management fee), **mandatory** `LoanBrokerCoverDeposit` | `{spv, vaultId, loanBrokerId, shareMptIssuanceId, vaultPseudoAccount, subscriptionEndsAt, redemptionAt, cover, coverEvent, events, txs, spvWallet}` |
| `depositToVault({projectId, vaultId, investor, amount})` | `VaultDeposit` | `{tx, event: vault_deposit}` |
| `closeLoanAndCreateEscrows(project, {conditions, cancelAfters?, builderAddress?, paymentTotal?, paymentIntervalS?, defaultCancelAfter?, waitForInvestmentPhase=true, spvSigners?, spvSingleKey?, allowOverpayment=true, originationFee?, originationFeePayer="builder", escrowMode?, onTx?})` — see **Loan close (XRPL-06, XRPL-13b)** | validation first (nothing submitted on bad input), then (if needed) payer → SPV RLUSD `Payment` for the origination-fee shortfall, `LoanSet` with `LoanOriginationFee` (platform signs under its account lock, SPV multisig countersigns), then the escrows: **one all-or-nothing `Batch`** of every `EscrowCreate` for 2..8 milestones (`escrowMode: "batch"`, default), else one `EscrowCreate` per milestone, back to back | `{loanId, loanSetTx, originationFee, originationFeeTopUpTx?, escrows: [{milestoneId, owner, offerSequence, condition, createTx, cancelAfter, amount, escrow}], txs, maturity, events, escrowMode, batchTx?}` |
| `resumeEscrowCreation(err \| {project, loanId, created?, pending?, conditions, cancelAfters?, loanSetTx?}, {escrowMode?, spvSigners?, spvSingleKey?, builderAddress?, issuer?, waitForInFlight=true, onTx?})` — see **Recovering a partial close** | re-reads the SPV's escrows (by condition) + history first, then only the missing `EscrowCreate`s (one `Batch` for 2..8) | the completed `CloseLoanResult` + `resumed: {created, alreadyPresent, submitted}` |
| `attestApproval({projectId, spv, milestoneId, role, signer, decision, notes?, verdictHash?, condition?})` | 1-drop `Payment` approver → SPV with a JSON memo (`xrlp/attestation/v1`) | `{tx, event: approval_attested, attestation}` |
| `releaseMilestone({projectId, milestoneId, escrow:{owner, offerSequence, condition}, fulfillment, amount?, submitter="releaseService", destination?, lastLedgerMargin=60, marginS=120})` | preflight (no tx) → `EscrowFinish` | `{tx, event: escrow_finished}` (amount from the escrow) |
| `tryFinishWithWrongFulfillment({owner, offerSequence, condition, projectId?, milestoneId?, submitter="platform"})` | `EscrowFinish` with a random wrong fulfillment → **`tecCRYPTOCONDITION_ERROR`** (resolves, does not throw) | `{tx, event: release_refused + result}` |
| `cancelExpiredMilestone({projectId, milestoneId, escrow, cancelAfter?, wait?, amount?, submitter="releaseService"})` | `EscrowCancel` (`TooSoonError` before CancelAfter, nothing submitted) | `{tx, event: escrow_cancelled}` (amount from the escrow) |
| `builderPayToSpv({projectId, spv, amount, builder="builder"})` | RLUSD `Payment` builder → SPV | `{tx, amount, from, to}` (no event kind yet, TODO(#53)) |
| `repayLoan({projectId, spv, loanId, amount?, mode?, source?: "builder"\|"escrow_refund", signers?, skipAmountCheck?})` | `LoanPay` (SPV multisig, default platform + builder + trustee, per-account locked) | `{tx, event: loan_payment, amount, mode, plan}` |
| `withdrawFromVault({projectId, vaultId, investor, amount})` | `VaultWithdraw` (`TooSoonError` in the Investment phase, nothing submitted) | `{tx, event: vault_withdraw}` |
| `issueCredential({subject, type, uri?, accept=true, projectId?})` **@deprecated** | delegates to `grantCredential` (idempotent): `CredentialCreate` if missing, `CredentialAccept` if pending | `{createTx, acceptTx?, event: credential_issued, status, txs, events}`. If the credential already existed, `createTx`/`event` describe the existing on-ledger `CredentialCreate` and `txs`/`events` (what this call submitted) are empty |
| `getVaultStatus(vaultId)` / `getShareBalance(holder, mptId)` / `getLoan(loanId)` / `getSpvInfo(addr)` | reads | |

### Broker rates, first-loss cover, fees (XRPL-04)

Pure helpers in `src/lending-math.ts` (exported from the package root, unit-tested offline). XLS-66 rates are in
1/10 bps (`100000` = 100%); our fee bps are plain bps (`10000` = 100%).

| Constant / helper | Default | Meaning |
|---|---|---|
| `COVER_RATE_MINIMUM` | `10000` (10%) | `LoanBrokerSet.CoverRateMinimum`: cover must stay ≥ 10% of debt, else `LoanSet` → `tecINSUFFICIENT_FUNDS` (devnet-verified) |
| `COVER_RATE_LIQUIDATION` | `100000` (100%) | `LoanBrokerSet.CoverRateLiquidation`: share of the minimum cover liquidated to the vault on default |
| `MANAGEMENT_FEE_RATE` | `10000` (10% of interest, protocol max) | `LoanBrokerSet.ManagementFeeRate` → shows as `Loan.ManagementFeeOutstanding` |
| `ORIGINATION_FEE_BPS` / `originationFeeFor(principal, bps?)` | `150` (1.5%) | `LoanSet.LoanOriginationFee`, taken from the principal and paid to the platform at LoanSet |
| `validateBrokerRates({coverRateMinimum, coverRateLiquidation, managementFeeRate})` | | both cover rates zero or both non-zero (`temINVALID` otherwise), ranges |
| `expectedInterest({principal, interestRate, paymentTotal, paymentIntervalS})` | | amortized XLS-66 interest (matches devnet `TotalValueOutstanding` to 6 dp) |
| `minimumCover({principal, interest, existingDebt?, coverRateMinimum?})` | | `ceil((debt + principal + interest) × CoverRateMinimum)` |
| `defaultCoverDeposit({...})` | | `max(10% of principal, minimumCover + 10% headroom)` (`COVER_HEADROOM_BPS`) |
| `loanScheduleFromTerms(terms)` | | `{paymentTotal: round(termDays / paymentIntervalDays) ≥ 1, paymentIntervalS}` |
| `vaultDatesFor({subscriptionDate, paymentTotal, paymentIntervalS, bufferS?})` | `bufferS` 2 days | `RedemptionDate = SubscriptionDate + interval × total + 60 + buffer` |
| `validateVaultDates({subscriptionDate, redemptionDate, paymentTotal?, paymentIntervalS?, minLoanSetWindowS=60})` | | ≥ 180 s apart and `RedemptionDate ≥ Sub + interval × total + 60 + window`. `createVault({loanSchedule})` calls it |

- `createLoanBroker` now **always** sets the three rates (defaults above; pass `0/0` cover rates to opt out).
- `setupProjectOnChain` validates rates, dates and the cover amount **before any tx**, checks the platform holds enough
  RLUSD, then always deposits cover. An explicit `coverDeposit` below `minimumCover` is rejected. The cover is sized
  for `paymentTotal`/`paymentIntervalS` (default from terms; pass the same values you will pass to `closeLoanAndCreateEscrows`).
- **`cover_deposited` event:** in `setup.events` (right after `loan_broker_created`) and also returned as
  `setup.coverEvent` (+ `setup.cover` details).
- **Origination fee vs escrows:** `LoanSet` sends `principal − fee` to the SPV, but milestone escrows sum to the full
  principal. `closeLoanAndCreateEscrows` therefore has `originationFeePayer` (default demo `builder`) pay the shortfall
  into the SPV just before `LoanSet` ("points paid at closing"), and fails fast with a clear error if the payer lacks
  the RLUSD. Pass `originationFee: "0"` to skip the fee.

Defaults: `repayLoan` pays one periodic payment (`PeriodicPayment + LoanServiceFee`, rounded up) and picks the mode
from ledger time and `source` (see "Finish, cancel, repay, withdraw" below).
`closeLoanAndCreateEscrows` takes CancelAfter from `cancelAfters[i]`, else `milestone.cancelAfter`, else `defaultCancelAfter`
(default: maturity − one payment interval); every one must be before loan maturity. SPV quorum for `LoanSet`/`EscrowCreate`/`LoanPay` defaults to **platform + builder + trustee**
(`defaultSpvSignerWallets()`). Those three are the same for every project whichever inspector was assigned. Pass
`spvSigners` / `signers` to sign with the inspector instead. Any 3 of the 4 work. The AI key is never a signer.

### SPV (XRPL-05)

| Function | What |
|---|---|
| `createSpv({issuer, signers: {platform, builder, inspector, trustee}, lock=true})` | fund, RLUSD `TrustSet`, `SignerListSet` w1 ×4 quorum 3, `asfDisableMaster` → `{address, wallet, txs}` |
| `lockSpv(wallet, signers)` / `lockSpvAccount(wallet, partialSigners?)` | `SignerListSet` + `asfDisableMaster` (fallback path: lock after LoanSet). `lockSpvAccount` fills gaps from the demo roles via `spvSignersFor()` |
| `submitMultisigned(tx, signerWallets, {checkQuorum=true, ...SubmitOptions})` | Checks the account's on-ledger SignerList first and throws `XrplTxError` `tefBAD_QUORUM` / `tefBAD_SIGNATURE` / `tefNOT_MULTI_SIGNING` immediately (xrpl.js would otherwise wait ~1 min for a `tef`). Then `submitWithSigner(spv, {...tx, SigningPubKey: ""}, multisignWith(signers), {signersCount})`: autofill → multisign → submit → validation **under `withAccountLock(spv)`**, so parallel multisig txs for one SPV never race on `Sequence`, and transient failures re-sign with all signers. `multisignAndSubmit` = compat alias. Devnet: 4 parallel multisig Payments from one SPV → Seq 6391602..6391605 all `tesSUCCESS` (27.5s) |
| `multisignWith(signerWallets)` / `assertSignerQuorum(txType, info, addresses)` | the `sign` callback for `submitWithSigner`; the local quorum check (throws the `tef*` rippled would return) |
| `multisignBlob(tx, signerWallets)` | `{blob, hash}` without submitting (not locked; submit via `submitMultisigned`) |
| `checkSignerQuorum(list, addresses)` | pure: `{ok, weight, quorum, unknown, duplicates}` |

`tef*` (2 signatures, non-member signer, master key) never reaches the ledger, so there is no explorer link. See
docs/xrpl-protocol-notes.md §2b. `pnpm --filter @xrlp/xrpl spike:spv` reproduces it on devnet.

### Compliance + attestations (XRPL-08, `src/compliance.ts`)

Platform/issuer default to the demo store; every function also takes `platform`/`issuer` overrides (fresh wallets).
Devnet proof and tx links: `docs/xrpl-protocol-notes.md` §3b.

| Function | Txs | Returns |
|---|---|---|
| `payVerificationFee({builder, amount="250", projectId?, platform?, issuer?})` | RLUSD `Payment` builder → platform | `{tx, event: verification_fee_paid}` |
| `grantCredential({subject, type, uri?, accept=true, projectId?, platform?})` | `CredentialCreate` (platform) if missing, `CredentialAccept` (subject) if pending. **Idempotent** | `{status, createTx?, acceptTx?, txs, events: credential_issued / credential_accepted}` |
| `revokeCredential(issuerWallet, subject, type)` / `getCredential(subject, issuer, type)` (`credentials.ts`) | `CredentialDelete` by the issuer, only if the credential exists (idempotent) / read the `Credential` object | `TxResult \| undefined` / `CredentialEntry \| undefined` |
| `createDomain({platform?, types=["KYC_INVESTOR"]})` | `PermissionedDomainSet`, AcceptedCredentials = [platform, KYC_INVESTOR]. Idempotent (reuses an identical owned domain) | `{domainId, tx?}` |
| `createVault({..., domainId, nonTransferableShares: true})` (`vault.ts`) | `VaultCreate` + `tfVaultPrivate` + `DomainID` (+ `tfVaultShareNonTransferable`) | as before |
| `attest({signer, spv, memo, projectId?})` | 1-drop XRP `Payment` signer → SPV, memo `xrlp/attest/v1` | `{tx, memo, event}` |
| `submitSignedBlob(blob, {expectSigner?, expectSpv?, projectId?})` | submits an inspector-app-signed attestation after `verifyAttestBlob` | `{tx, memo, signer, event}` |

`CredentialType = "VERIFIED_BUILDER" | "VERIFIED_INSPECTOR" | "KYC_INVESTOR"`, on-ledger as hex ASCII (`credentialTypeHex`).
Non-KYC (or KYC issued but not accepted) `VaultDeposit` into a private vault → **`tecNO_AUTH`** (on-ledger).

`AttestMemo = { v:1, kind: "audit"|"verdict"|"decision"|"release", milestoneId, hash /*sha256 hex*/, decision?, reason? }`
(≤ 900 bytes JSON). Event kinds: audit → `audit_attested`, verdict → `verdict_attested`, decision → `decision_attested`,
release → `approval_attested` (shared v2 has no dedicated release kind). `AttestMemo` is the shared type. Other v2 kinds
emitted here: `verification_fee_paid`, `credential_issued` + `credential_accepted`.

Inspector-app flow (no platform key involved):
```ts
const unsigned = await prepareAttestTx({ account: inspector, spv, memo }); // or buildAttestTx (pure, not autofilled)
const { tx_blob } = softwareSigner.sign(unsigned);                        // in the inspector app
await submitSignedBlob(tx_blob, { expectSigner: assignedInspector, expectSpv: spv });
```
`verifyAttestBlob` (offline) rejects anything that is not a single-signed `Payment` of exactly `"1"` drop with no
Paths/SendMax/DeliverMin/flags, exactly one valid `xrlp/attest/v1` memo, and a valid signature. Pure helpers:
`encodeAttestMemo`, `decodeAttestMemo(txJson)`, `validateAttestMemo`, `decodeAnyAttestation` (also reads the v1
`xrlp/attestation/v1` memo still written by `attestApproval`).

### Loan close (XRPL-06, XRPL-13b): `closeLoanAndCreateEscrows`

Conditions are **generated by core's release service** (CORE-12, preimage unique per escrow, encrypted at rest) and passed in.
This package never generates preimages. The old `generateMilestoneCondition` export is gone (its last user, `scripts/demo.ts`, now
takes conditions from the release-service stand-in in `scripts/demo-lib.ts`); tests and spikes use `test/support/conditions.ts` (`testConditionPair[s]`).

```ts
const close = await closeLoanAndCreateEscrows(project, {
  conditions,              // string[] by milestone index | Record<milestoneId, cond> | {milestoneId, condition}[]
  cancelAfters,            // optional ISO[] by milestone index (overrides milestone.cancelAfter / defaultCancelAfter)
  builderAddress: builder.address,
  waitForInvestmentPhase: false, // LedgerPort semantics: throw TooSoonError instead of waiting
  // escrowMode: "batch" (default for 2..8 milestones) | "sequential"; onTx: (e) => log(e.step, e.tx.explorerUrl)
});
// close.escrows[i] = { milestoneId, owner, offerSequence, condition, cancelAfter, createTx, amount, escrow } (≅ shared EscrowRef)
// close.txs = [LoanSet, EscrowCreate × N] (shared CloseResult.txs); close.maturity = ISO lower bound of loan maturity
// close.escrowMode = "batch" → close.batchTx = the outer Batch; escrows[i].createTx / txs[1..N] are its inner EscrowCreates
```

Order: vault phase gate → (SPV submit lock) `planLoanClose` (pure) + SPV quorum check → origination-fee top-up → `LoanSet` →
one `Batch` of `EscrowCreate × N` (or `EscrowCreate × N`).
**Everything is checked before the first tx**, so bad input never leaves principal liquid in the SPV:

| Check | Error (nothing submitted) |
|---|---|
| vault still in Subscription and `waitForInvestmentPhase: false` (default `true` waits) | shared `TooSoonError` (`code: "too_soon"`). A `tecTOO_SOON` LoanSet is rethrown as `TooSoonError` too |
| `PaymentTotal` integer ≥ 2, `PaymentInterval` integer ≥ 60 s, `0 < InterestRate ≤ 100000` (1/10 bps) | `CloseValidationError` (`code: "validation"`, `issues: string[]`, all problems at once) |
| loan fits the vault: `now + interval × total + 60 ≤ RedemptionDate` | 〃 |
| one condition per milestone (no extras / unknown ids), each `A0258020<64 hex>810120` (78 hex, case-insensitive, stored uppercase) | 〃 |
| no duplicate condition within the call, none already on an **open escrow of the SPV** (`account_objects`): also guards against re-running a close | 〃 |
| `ledger now + 60 s` (`MIN_ESCROW_LIFETIME_S`) `< CancelAfter_i < maturity`, where maturity = `ledger now + interval × total` (lower bound: the real LoanSet starts later) | 〃 |
| milestone amounts > 0, ≤ 6 decimals, sum ≤ principal; SPV signers reach the on-ledger quorum | 〃 |
| SPV master key disabled (multisig path; `spvSingleKey` is the explicit fallback) — else the SPV's own seed controls the principal | 〃 |
| escrow destination (`builderAddress`): a classic address, an existing account, not the SPV / issuer / another demo role's key, and on the SPV's on-ledger signer list (`escrowDestinationProblems`; security review M5) | 〃 |
| a condition that fails the format check is described, never echoed (a fulfillment / raw preimage passed by mistake stays out of errors, HTTP bodies and logs; M2) | 〃 |

LoanSet terms: platform = `Account`, SPV = `Counterparty` (multisig, default platform + builder + trustee), `tfLoanOverpayment`,
no late fees, origination fee as in XRPL-04. `loanSet` itself also rejects `PaymentTotal < 2` / `InterestRate ≤ 0`.
If an escrow step fails **after** LoanSet (an `EscrowCreate`, a Batch that did not apply, an `onTx` throw): `CloseLoanPartialError`
(extends shared `LedgerError`, `code: "ledger_error"`, `txResult`/`txHash` of the failed EscrowCreate or Batch) with `loanId`,
`loanSetTx`, `created: CreatedEscrowRef[]`, `pending: milestoneId[]` (failed one first) and `context` (the plan, escrow mode, the
Batch's hash / LastLedgerSequence / outcome, whether a tx may still be in flight). Recover with `resumeEscrowCreation(err)` (below)
or repay. Pure validator: `planLoanClose(input)` (`src/loan-close.ts`, offline tests in `test/loan-close.test.ts`). Devnet proof:
`docs/xrpl-protocol-notes.md` §2c (sequential), §2e (batch).

**Escrow mode (XRPL-13b).** For 2..8 milestones (the XLS-56 inner-tx limit) the escrows go in **one all-or-nothing Batch**
(`escrowMode: "batch"`, the default): outer = SPV, multisigned by `spvSigners` (or signed by `spvSingleKey`), `tfAllOrNothing`,
one inner `EscrowCreate` per milestone. Either every escrow exists or none does, and the SPV holds liquid principal only from the
LoanSet ledger to the Batch ledger (§2e). Other counts, or `escrowMode: "sequential"`, create one EscrowCreate per milestone (the
XRPL-06 path); `"batch"` for 1 or 9+ milestones → `CloseValidationError`. LoanSet itself can't join the Batch on devnet yet
(`temINVALID_INNER_BATCH` until `LendingProtocolV1_2`, §2d).
- `escrows[i].createTx` / `txs[1..N]` / the `escrow_created` events carry the Batch's **inner** EscrowCreates (their own on-ledger
  txs, `ParentBatchID` in the metadata); `offerSequence` = the inner Sequence; the outer Batch is `close.batchTx`.
- Every escrow passes `planLoanClose`, then `validateEscrowSpecs` again right before signing (`createEscrowsAtomic` and
  `closeLoanAtomic` run it too, the latter before its LoanSet): a malformed condition never reaches the ledger in either mode.
- **Rollback detection.** A Batch whose inner txs did not apply is still `tesSUCCESS` (the outer pays the fee) and its metadata
  looks the same either way (only the outer account's fee + Sequence). So every inner hash is looked up **in the Batch's own
  ledger**: `meta.ParentBatchID` must match; not found with `searched_all` = provably not applied (`BatchNotAppliedError`,
  `batch.outcome: "rolled_back"`) → `CloseLoanPartialError` with **all** milestones pending (`txResult: "inner_failed"`,
  `txHash` = the Batch). Each applied inner must also have created the expected `Escrow` (SPV → builder, same condition).
- `onTx(e)` is awaited after each validated tx: `origination_fee`, `loan_set`, then `escrow_batch` or `escrow_create`.
- Validation through the last escrow holds the SPV's submit lock: a concurrent second close of the same project in this process
  waits, then is refused before any tx (its conditions are on the SPV's escrows).

### Fully atomic close (XRPL-13): `closeLoanAtomic`

`closeLoanAtomic({loan, builder, issuer, milestones, spvSigners, mode?})` → `{mode, loanId, loanSetTx, batchTx, escrows, fallback?}`.
Not on the core path (that is `closeLoanAndCreateEscrows` above). Modes:
- `"escrows"` (default): countersigned LoanSet, then one all-or-nothing Batch of 2..8 EscrowCreates (same as the batch escrow mode).
- `"full"`: **one** Batch, outer = platform (single-sig), inners = LoanSet (`Counterparty` = SPV, no `CounterpartySignature`)
  + 1..7 EscrowCreates from the SPV, `BatchSigners` = SPV multisig. The SPV never holds liquid principal. Needs
  `LendingProtocolV1_2`: devnet rippled 3.4.1 refuses it with `temINVALID_INNER_BATCH` (re-checked 2026-10-25 06:05 UTC, §2d).
- `"auto"`: tries `"full"` for 1..7 milestones. If the network refuses LoanSet as an inner tx (`temINVALID_INNER_BATCH`,
  `isInnerLoanSetUnsupported(e)`; a tem never reaches the ledger, so no fee and no Sequence are used) it falls back to `"escrows"`
  and sets `fallback: {from: "full", engineResult, message}`. Any other failure is rethrown with no fallback LoanSet. One
  milestone can't fall back (a Batch needs 2 inners), so the tem is rethrown. 8 milestones go straight to `"escrows"`. `result.mode`
  is the mode that ran. Once devnet enables V1_2, `"auto"` does the full close with no code change.
- `deps?: {ledgerTime, loanSet, submitBatch}` is the offline-test seam.

### Recovering a partial close (XRPL-13b): `resumeEscrowCreation`

`resumeEscrowCreation(err)` creates **exactly the missing escrows** and returns the completed `CloseLoanResult` plus `resumed`.
It is idempotent: before submitting anything it re-reads the SPV's escrows and matches them **by condition**, so a retry never
double-creates and a second run submits nothing.

```ts
let close: CloseLoanResult;
try {
  close = await closeLoanAndCreateEscrows(project, { conditions, cancelAfters, builderAddress, waitForInvestmentPhase: false });
} catch (e) {
  if (!(e instanceof CloseLoanPartialError)) throw e; // nothing submitted, or the LoanSet itself failed
  // fix a persistent cause first (frozen line, missing RLUSD), then:
  close = await resumeEscrowCreation(e);
  // without the error object (e.g. after a restart): builderAddress is REQUIRED, and it waits one LLS margin first
  // close = await resumeEscrowCreation({ project, loanId, created, pending, conditions, cancelAfters }, { builderAddress });
}
// close.resumed = { created: ["m2", "m3"], alreadyPresent: [{ milestoneId: "m1", source: "created" }], submitted: [<Batch>] }
```

In order (nothing is submitted before step 5):
1. **In-flight wait.** If the failed submit's outcome was unknown (`context.uncertain`: connection lost, incomplete server history),
   wait until that tx can no longer validate: past the Batch's `LastLedgerSequence`, else one `DEFAULT_LLS_MARGIN` (20 ledgers).
   The `{project, ...}` form has no record of what was in flight (e.g. after a restart), so it always waits one margin
   (`waitForInFlight: false` skips it), and its `builderAddress` is required and checked like the close's (security review M8).
2. **Loan.** It must exist with `Borrower` = the SPV. Its real maturity (`NextPaymentDueDate + interval × (remaining − 1)`) bounds
   every new CancelAfter.
3. **What exists** (`planEscrowResume`, pure). A milestone is *present* (never re-created) when the failed close reported it
   (`created`), when an **open SPV escrow** has its condition (`account_objects`), or when the SPV's history has a successful
   EscrowCreate with it that is gone (finished or cancelled: re-creating it with a possibly published fulfillment could pay twice).
   A present escrow must go to the builder for the milestone's amount, else `CloseValidationError`. Missing ones must pass the
   close's checks: well-formed, unique, `now + 60 s < CancelAfter < maturity`. `{project, ...}` form: CancelAfter = `cancelAfters[i]`
   → `milestone.cancelAfter` → real maturity − one payment interval.
4. **Funds.** The SPV must hold the RLUSD for the missing escrows (else `CloseValidationError`, no fee burnt on a doomed Batch).
5. **Create** under the SPV's submit lock: one Batch for 2..8 missing escrows, else sequential (`escrowMode` overrides). A failure
   here → a new `CloseLoanPartialError` (resume that one).

The result lists every milestone in project order; `txs` / `events` for escrows that already existed are rebuilt from the SPV's
history. `deps` injects every network call (the escrow lister `listEscrowNodes`, `accountTx`, `getLoan`, `ledgerNow`, `rlusdBalance`,
`fetchTx`, `createEscrowsAtomic`, `createMilestoneEscrow`, `sleep`): offline tests in `test/close-batch.test.ts` (recorded devnet
Batches: `test/fixtures/batch-*.json`, re-record with `scripts/capture-batch-fixtures.ts`). Devnet proof: `docs/xrpl-protocol-notes.md` §2e.

### Escrow gating (release-service-held preimage, no Shamir)

At release, core's release service passes the `fulfillment` to `releaseMilestone`, which checks it (`fulfillmentMatches`),
runs `preflightFinish` and submits `EscrowFinish`. AI, inspector and platform approvals go on-chain as memo attestations
(an audit trail), but they are **not** release keys. Trust assumption: whoever holds the fulfillment can release to the builder
(and only to the builder). Signers can't redirect escrowed funds.

### Pre-reveal safety: `preflightFinish` (XRPL-14)

A failed `EscrowFinish` carrying the right fulfillment (`tecNO_LINE`, past `CancelAfter`, ...) **publishes the preimage
while the escrow stays open**. So `finishEscrow` / `releaseMilestone` call `preflightFinish` first and throw
`UnsafeReleaseError` without submitting anything. It **extends the shared `LedgerError`** (`code: "unsafe_release"`,
plus `reason` and the full `result`), so LedgerPort callers can rethrow it as is. Pass `skipPreflight: true` only in negative spikes.

```ts
const r = await preflightFinish({ owner, offerSequence, destination: builder, condition, fulfillment, submitter }); // never submits
if (!r.ok) return unsafeReleaseError(r); // { error: { code: "unsafe_release", message, reason } }
// r.details.recommendedFee / r.details.lastLedgerSequence -> use in the EscrowFinish
```

All reads are pinned to one **validated** ledger, and time is that ledger's `close_time`. `reason` is one of `escrow_not_found`,
`destination_mismatch`, `condition_mismatch` (checked against the **on-ledger** Condition), `finish_too_early`,
`expired_or_too_close` (`CancelAfter − now < max(marginS=120, lastLedgerOffset=20 × 5s)`), `unsupported_amount` (MPT),
`destination_not_found`, `deposit_auth`, `no_trustline`, `trustline_limit` (limit − balance < amount, exact decimals),
`not_authorized`, `frozen`, `submitter_not_found`, `submitter_unfunded`. Fee = `base × (33 + ⌈fulfillment bytes/16⌉)`
(36 drops on devnet). The pure core `evaluatePreflight(snapshot, now)` is unit-tested offline. The fetch layer uses the
reads.ts primitives (`fetchLedgerNow`, `fetchEscrowNode`, `fetchAccountRoot`, `fetchAccountLines` + `findTrustLine`) pinned to
one ledger index. `PreflightSnapshot.escrow` is the raw `PreflightEscrow` (the old `EscrowSnapshot` name is a deprecated
alias in preflight.ts; it is not the shared `EscrowSnapshot`). Devnet proof:
`pnpm --filter @xrlp/xrpl spike:preflight` (a builder with no trust line is refused and nothing is submitted, then it finishes once the line exists; a short-`CancelAfter` escrow is refused inside the margin).

### Default handling (XRPL-15, `src/default.ts`)

Released-but-unrepaid money is credit loss (stall path, `docs/03-architecture.md`). The platform, as LoanBroker owner, writes it
off with `LoanManage`: the first-loss cover absorbs `DefaultCovered`, and the vault writes down the rest. Only the broker owner may
submit. Devnet proof and numbers: `docs/xrpl-protocol-notes.md` §3c (`pnpm --filter @xrlp/xrpl spike:default`).

| Function | Tx | Returns |
|---|---|---|
| `defaultLoan({loanId, projectId, brokerOwner?="platform", skipGuard?})` | `LoanManage tfLoanDefault` | `{tx, event: loan_default (amount = DefaultAmount, at = ledger close time), outcome: DefaultOutcome, alreadyDefaulted}` |
| `impairLoan({loanId, brokerOwner?, skipGuard?})` | `LoanManage tfLoanImpair` | `{tx, outcome: ImpairOutcome}`. **No ChainEvent**: shared v2 has no impairment kind, and `loan_default` would claim a default that hasn't happened |
| `unimpairLoan({loanId, brokerOwner?, skipGuard?})` | `LoanManage tfLoanUnimpair` | `{tx, outcome: ImpairOutcome}` (no ChainEvent) |
| `fetchLoanManageState(loanId)` | — | `{ledgerIndex, now, loan, broker, vault}`, all from one validated ledger |

**Guard first, nothing submitted on refusal.** The pure `checkLoanManage({action, loan, now, submitter?, brokerOwner?, vault?})` runs
rippled 3.4.1's checks in rippled's order, against the latest validated ledger, under `withAccountLock(platform)` (XRPL-12):

| Rule (devnet: `fixCleanup3_4_0` = exclusive boundaries) | Ledger would say | Thrown |
|---|---|---|
| default only when ledger close time **>** `NextPaymentDueDate + GracePeriod` | `tecTOO_SOON` | `LoanManageTooSoonError`: the shared `TooSoonError` (`code: "too_soon"`) plus `allowedAfter` (Ripple s) / `allowedAfterIso` for the retry |
| impair only when ledger close time **>** `NextPaymentDueDate` (payment overdue) | `tecTOO_SOON` | 〃 |
| submitter ≠ `LoanBroker.Owner` | `tecNO_PERMISSION` | `LoanManageRefusedError`: shared `LedgerError` (`code: "ledger_error"`) with `reason` + `expectedResult` |
| loan defaulted / fully paid / impair twice / unimpair an unimpaired loan | `tecNO_PERMISSION` | 〃 |
| impair would push `LossUnrealized` above `AssetsTotal − AssetsAvailable` | `tecLIMIT_EXCEEDED` | 〃 |
| no such loan | `tecNO_ENTRY` | 〃 |

rippled checks the timing **before** the owner, so a non-owner defaulting too early gets `tecTOO_SOON`, not `tecNO_PERMISSION`.
`skipGuard: true` is for negative spikes only (it lets the ledger's `tec` land on-ledger).

**Exposure follows the vault's accounting.** `Vault.LEVersion 1` (`LendingProtocolV1_1` cash basis, every devnet vault): `DebtTotal`
and `AssetsTotal` hold principal only, so impair/default use `Loan.PrincipalOutstanding`. A legacy accrual vault (no `LEVersion`) uses
`TotalValueOutstanding − ManagementFeeOutstanding` (XLS-66 §3.10.5). `loanExposure(loan, vaultAccounting(vault))`.

**Cover math** (pure, exact decimals): `expectedDefaultCovered({debtTotal, coverRateMinimum, coverRateLiquidation, defaultAmount,
coverAvailable, loanScale?})` = `min(roundUp(min(DebtTotal × CRM × CRL, DefaultAmount), 10^LoanScale), CoverAvailable)`, rates in 1/10 bps
(÷ 100000 each). With our rates (10% / 100%): **10% of `DebtTotal` at default time**, capped by the exposure and by the posted cover.
Note `DebtTotal` falls as principal is repaid, so the cover a default can draw shrinks with it.

`DefaultOutcome` (from the tx metadata, so before/after are atomic; Rlusd figures truncated to 6 dp, `exact` holds the ledger decimals):
`{loanId, accounting, wasImpaired, defaultAmount, defaultCovered, expectedDefaultCovered, vaultLoss, debtTotal {before, after},
coverAvailable {before, after}, vault {before, after}: {assetsTotal, assetsAvailable, lossUnrealized, sharePrice, netSharePrice},
sharesOutstanding, exact}`. `sharePrice` uses the `getVaultSnapshot` formula (AssetsTotal per whole share, what the UI shows);
`netSharePrice` is the XLS-65 §3.1.7.1 exchange rate `(AssetsTotal − LossUnrealized) / shares`, what a withdrawal pays.
`ImpairOutcome` = `{loanId, action, accounting, exposure, vault {before, after}, nextPaymentDueDate, sharesOutstanding}`.

**Idempotent default.** Calling `defaultLoan` on a loan that is already defaulted submits nothing. It returns the original default tx,
found through `Loan.PreviousTxnID` (nothing can modify a defaulted loan), with its outcome and event and `alreadyDefaulted: true`.
Two concurrent keeper calls give one default and one replay, because the guard runs inside the account lock.

Pure helpers: `checkLoanManage`, `canDefaultAt(loan, now)`, `canImpairAt(loan, now)`, `defaultableAfter(loan)`, `impairableAfter(loan)`,
`expectedDefaultCovered`, `loanExposure`, `vaultAccounting`, `parseDefaultOutcome(meta, {loanId, sharesOutstanding})`,
`parseImpairOutcome(meta, {loanId, action, sharesOutstanding})` (offline tests: `test/default.test.ts`, incl. recorded devnet txs).

**LedgerPort:** shared v2 has no default method yet. Proposed on #53: `defaultLoan(p: { project: Project }): Promise<TxResult & { outcome:
DefaultOutcome }>` for core's keeper (CORE-06); the adapter maps it to `defaultLoan({ loanId: project.chain.loanId, projectId: project.id })`
inside `XrplLedgerAdapter.run` (`src/adapter.ts`, `toAdapterError`), `kind: "loan_default"`. The keeper calls it once `canDefaultAt(loan, ledgerNow)` holds, or retries at
`err.allowedAfter` after a `LoanManageTooSoonError`.

### `XrplLedgerAdapter implements LedgerPort` (XRPL-10, `src/adapter.ts`)

The shared `LedgerPort` (`packages/shared/src/ports.ts`) over devnet, for core's `LEDGER_MODE=devnet`:

```ts
import { XrplLedgerAdapter } from "@xrlp/xrpl";
const ledger = new XrplLedgerAdapter({ walletsFile: process.env.WALLETS_FILE, log: console.log }); // mode = "devnet"
```

Options: `walletsFile` (sets the process-wide wallet store path), `log` (one line per tx with its explorer link, and per
refusal), `privateVault` (default `true`), `finishMargins` (`{lastLedgerMargin, marginS}`, used by both `preflightFinish` and
`finishEscrow`; default 60 ledgers → preflight wants ≥ 300 s before CancelAfter; short-dated spikes pass `{ lastLedgerMargin: 20, marginS: 60 }`). Keys come from the wallet store: **every address core passes that must sign**
(builder, investors, credential subjects, SPV signers) must be a bootstrapped wallet; else `validation`.
**Keys are bound to roles** (security review M4, `SIGNING_ROLES` / `keyForRole` in `adapter-map.ts`): an investor address must
be `investor1..3`'s, a builder address the `builder`'s, a credential subject the role its type is for (KYC_INVESTOR → investors,
VERIFIED_BUILDER → builder, VERIFIED_INSPECTOR → inspectors), an `attest` signer one of `aiAgent | platform | releaseService`.
Another role's address (e.g. the issuer's, registered as an "investor" over HTTP) → `validation`, nothing signed. The SPV
quorum picker never uses the `aiAgent` / `releaseService` / `issuer` keys, and `setupProjectOnChain` refuses them as builder
or inspector before any tx (M6).

| Port method | Does | Kinds on `TxResult` |
|---|---|---|
| `payVerificationFee({builder, amount})` | builder → platform RLUSD Payment | `verification_fee_paid` |
| `issueCredential({subject, type})` | `grantCredential` (idempotent): CredentialCreate + subject's CredentialAccept. **Already accepted → `[]`** | `credential_issued`, `credential_accepted` |
| `setupProjectOnChain({project, builder, inspectors, subscriptionDate, redemptionDate, coverDeposit?})` | platform PermissionedDomain (idempotent, KYC_INVESTOR) → SPV (TrustSet, SignerList **platform / `builder.address` / `inspectors[0]` / trustee**, quorum 3, master disabled) → private closed-ended vault (dates from the ISO args, `AssetsMaximum` = principal, non-transferable shares) → LoanBroker → cover deposit. Validates 4 distinct signers | `txs`: domain? / SPV ×3 (no kind) · `vault_created` · `loan_broker_created` · `cover_deposited` |
| `deposit` | VaultDeposit (investor must hold an accepted KYC_INVESTOR) | `vault_deposit` |
| `withdraw` | **`TooSoonError` before RedemptionDate (pre-checked, nothing submitted; stricter than `withdrawFromVault`, which allows Subscription-phase withdrawals)**, else `withdrawFromVault` | `vault_withdraw` |
| `closeLoanAndCreateEscrows({project, builder, conditions, cancelAfters})` | api.ts `closeLoanAndCreateEscrows(project, {conditions, cancelAfters, builderAddress, spvSigners, waitForInvestmentPhase: false})`: **`TooSoonError` while ledger ≤ SubscriptionDate**, then `planLoanClose` (one PREIMAGE-SHA-256 condition + CancelAfter per milestone by index, **no duplicates** incl. the SPV's open escrows, now + 60 s < CancelAfter **< loan maturity**) → `validation`. Nothing submitted on either refusal. SPV signers = quorum from the **on-ledger** SignerList whose keys we hold (builder, platform, trustee preferred). LoanSet → EscrowCreate × N | `txs[0]` `loan_set`, `txs[1..N]` `escrow_created`, then (if paid) the origination-fee top-up Payment (no kind) |
| `preflightFinish({owner, offerSequence, destination})` | `preflightFinish` as the releaseService. `reason` = `"<PreflightReason>: <message>"` | — |
| `finishEscrow` | `releaseMilestone` by **releaseService** with `finishMargins`; re-runs preflight (refusal → `unsafe_release`, nothing submitted) | `escrow_finished` |
| `tryFinishWithWrongFulfillment` | api.ts `tryFinishWithWrongFulfillment` from platform (random wrong fulfillment); **resolves** with the tec (`tecCRYPTOCONDITION_ERROR`). Escrow gone or near/past CancelAfter → `unsafe_release`, nothing submitted | `release_refused` |
| `cancelEscrow` | `cancelExpiredMilestone` by releaseService, checked on one validated ledger first: consumed → `not_found`, **`TooSoonError` before CancelAfter**; nothing submitted on either | `escrow_cancelled` |
| `repayLoan({project, amount, source})` | `planLoanPayment` first (amount < one periodic payment or > outstanding → `validation`, nothing submitted), and the SPV quorum. `"builder"`: `builderPayToSpv` (logged, not returned) then LoanPay; `"escrow_refund"`: LoanPay from what the SPV holds. Mode (api.ts `repayLoan`): past due → `late`; `escrow_refund` above one periodic payment → `overpayment`; else `regular`. SPV multisig from the on-ledger list | `loan_payment` |
| `attest({signer, spv, memo})` | `xrlp/attest/v1` from aiAgent / platform / releaseService | `audit_attested` / `verdict_attested` / `decision_attested` / `approval_attested` (release) |
| `submitSignedBlob(blob)` | inspector-app-signed attestation (shape-checked before submit) | by memo kind |
| `getVaultSnapshot` / `getLoanSnapshot` | `src/reads.ts`; missing → `not_found` | — |
| `getEscrow(owner, seq)` | `EscrowSnapshot` or `null` (finished / cancelled / never created) | — |
| `getBalance(account, "XRP"\|"RLUSD")` | RLUSD from our issuer; XRP total | — |

`TxResult.at` = the tx's ledger close time when rippled returns `date`.

**Errors.** Every method throws a shared `LedgerError`: `TooSoonError` (`code "too_soon"`, from the pre-checks or `tecTOO_SOON`),
or `XrplLedgerError extends LedgerError` with `apiCode` = the full API `ErrorCode`:

| From | `apiCode` | `code` (shared union) |
|---|---|---|
| `tecTOO_SOON`, phase pre-checks | `too_soon` | `too_soon` (`TooSoonError`) |
| `UnsafeReleaseError` (preflight refused inside `finishEscrow` / `tryFinishWithWrongFulfillment`; a shared `LedgerError`, passed through) | `unsafe_release` (+ `reason`) | `unsafe_release` |
| `tecNO_ENTRY` / `tecNO_TARGET` / `tecNO_DST` / `tecOBJECT_NOT_FOUND` / `tecNO_LINE`, rippled `entryNotFound` / `actNotFound`, missing vault/loan/escrow | `not_found` | `ledger_error` |
| `CloseValidationError` (XRPL-06), `LoanPayAmountError` (XRPL-07), `tem*`, adapter guards, package input errors (cover below minimum, bad dates, unknown wallet, ...) | `validation` | `ledger_error` |
| `CloseLoanPartialError` (LoanSet ok, an EscrowCreate failed; passed through with `loanId` / `created` / `pending`) | `ledger_error` | `ledger_error` |
| everything else (`tec*`, `tef*`, connection) | `ledger_error` | `ledger_error` |

Shared `LedgerError`s pass through as is. Everything else goes through errors.ts `toLedgerError` / `toErrorCode`
(`toAdapterError` in `src/adapter-map.ts`); `txHash` / `txResult` are kept and the original error is `cause`. Shared
`LedgerError.code` has only three values, so `not_found` / `validation` ride on `apiCode` (TODO #53: widen `code`).
Core: `apiCode ?? code` for the HTTP `ErrorCode` (or `apiCodeOf(e)`). Pure helpers (`toAdapterError`, `apiCodeOf`,
`toPortTx`, `pickQuorumSigners`) are unit-tested offline in `test/adapter.test.ts`.

Devnet e2e: `pnpm --filter @xrlp/xrpl adapter:e2e` (~6-8 min, bootstrap first) runs the whole port flow the way core
does and writes `.data/adapter-e2e.json`.

### Finish, cancel, repay, withdraw (XRPL-07)

| What | Behaviour |
|---|---|
| `finishEscrow` (`escrow.ts`) | `fulfillmentMatches` → `preflightFinish` (`lastLedgerOffset` 60 → margin to CancelAfter = max(120 s, 60 × 5 s) = 300 s) → `EscrowFinish` with preflight's Fee (sized for the fulfillment) + LastLedgerSequence. Each finish blob is signed right after its own preflight (under the submitter's account lock) and submitted **pre-signed**: the engine may resubmit that blob, never re-sign it (security review H3). If the submit throws `retriable: true` (nothing can apply), it **re-runs preflight and rebuilds once**; a refusal on that second preflight is `XrplTxError("preflight_refused_after_submit")`, not `unsafe_release`, so `unsafe_release` from a finish always means the fulfillment never left the process. `deps` (`preflightFinish`, `prepare`, `submitBlob`) for offline tests (`test/finish.test.ts`). Short-lived spike escrows: pass `lastLedgerMargin: 20, marginS: 60`. |
| `cancelEscrow` | Reads escrow + close time from one validated ledger (`getEscrowAtLedger`). `now ≤ CancelAfter` → shared **`TooSoonError`**, nothing submitted. Escrow gone → `XrplTxError tecNO_TARGET` (local, no hash → `not_found`). An on-ledger `tecNO_PERMISSION` is mapped to `TooSoonError` with `txHash`. |
| `finishWithWrongFulfillment` / `tryFinishWithWrongFulfillment` | Random 32-byte preimage (never matches), condition check skipped, but refuses (`UnsafeReleaseError`, nothing submitted) when the escrow is missing, past/within 30 s of CancelAfter, before FinishAfter, frozen/unauthorized, or the submitter is unfunded (`wrongFinishBlockers`). Resolves with the validated tec `TxResult`; throws if the tx never reached the ledger. |
| `loanPayMultisig({..., mode?, overpayment?})` (`loan.ts`) | `submitWithSigner` on the SPV: per-account lock through validation, re-sign on transient failures, local quorum check first (`tefBAD_QUORUM`/`tefBAD_SIGNATURE`, nothing submitted). |
| `planLoanPayment({loan, nowRipple, amount?, source?, mode?})` (pure) | `minimum` = min(one periodic payment + service fee, everything outstanding), rounded **up** to 6 dp. Mode unless given: past `NextPaymentDueDate` → `late`; `source: "escrow_refund"` with amount > minimum on an `lsfLoanOverpayment` loan → `overpayment`; else `regular` (builder repayments stay regular). Throws **`LoanPayAmountError`** (`code: "validation"`, nothing submitted) when amount < minimum (ledger: `tecINSUFFICIENT_PAYMENT`), amount > outstanding (non-`full`), or overpayment on a loan without the flag. |
| `withdrawFromVault` | `withdrawPhaseCheck(vault, ledgerTime)` first: Investment phase → shared **`TooSoonError`** (message has the RedemptionDate), nothing submitted. Subscription / Redemption / open vault → `VaultWithdraw`; an on-ledger `tecTOO_SOON` is mapped to `TooSoonError`. |

Devnet proof: `docs/xrpl-protocol-notes.md` §1b.

## Read models (`src/reads.ts`, XRPL-09)

Each read = a **pure parser** (raw rippled JSON → model, unit-tested on recorded devnet responses in
`test/fixtures/`) + a **thin fetch** that reads one validated ledger. "Now" is that ledger's `close_time`.
RLUSD values are shared `Rlusd` strings (plain decimal, ≤ 6 decimals, **truncated**). Fields rippled omits
(zero/default) read as `"0"` / `0`.

| Function | Returns | Notes |
|---|---|---|
| `getVaultSnapshot(vaultId)` | `VaultSnapshot \| undefined` | `{assetsTotal, assetsAvailable, sharesOutstanding, sharePrice, subscriptionDate, redemptionDate, phase}` (05-api §2). `sharesOutstanding` = raw share-MPT units (`OutstandingAmount`); `sharePrice` = `assetsTotal / (sharesOutstanding / 10^Vault.Scale)`, 6 dp, `"1"` with no shares. `phase` from ledger time: `subscription` (now ≤ SubscriptionDate), `investment`, `redemption` (now ≥ RedemptionDate); an open-ended vault reads as `subscription`. |
| `getLoanSnapshot(loanId)` | `LoanSnapshot \| undefined` | `{principalOutstanding, totalValueOutstanding, periodicPayment, paymentRemaining, nextPaymentDueDate}`. A paid-off loan has `paymentRemaining 0`, outstanding `"0"`, `nextPaymentDueDate ""` (rippled drops the field). |
| `getEscrowSnapshot(owner, offerSequence)` | shared `EscrowSnapshot \| null` | The `LedgerPort.getEscrow` shape: `{owner, offerSequence, destination, amount, condition?, cancelAfter? (ISO)}`. `null` = consumed or never created. Pure: `toEscrowSnapshot(view, seq?)`. |
| `getEscrow(owner, offerSequence)` | `EscrowView \| undefined` | `ledger_entry {escrow:{owner, seq}}`. `undefined` = consumed (finished/cancelled) or never created. `{index, owner, offerSequence, destination, currency: "RLUSD"\|"XRP"\|…, issuer?, amount, condition?, cancelAfter?, finishAfter? (ISO + *Ripple), status: "open"\|"expired", finishable, cancellable}`. `expired` = now > CancelAfter (finish fails, anyone can cancel). |
| `listEscrowsParsed(owner)` | `EscrowView[]` | Escrows **owned** by `owner` (incoming ones dropped), paginated `account_objects`. `offerSequence` comes from `Escrow.Sequence` (present on devnet). |
| `getBalance(account, "RLUSD"\|"XRP", {issuer?})` | decimal string | RLUSD from `account_lines` (any RLUSD line, or the given issuer); XRP = total incl. reserve. Unfunded / no line → `"0"`; issuer-side negative → `"0"`. |
| `hasRlusdTrustline(account, issuer?)` | `boolean` | Line exists, own limit > 0, not frozen by the issuer. For `preflightFinish` (XRPL-14). |

Pure parsers (no network; feed them recorded or fetched `result` objects, rippled error payloads like
`{error:"entryNotFound"}` included): `parseVaultSnapshot({ledger, vault, shareIssuance})`, `parseLoanSnapshot(result)`,
`parseEscrow(result, now, seq?)`, `parseEscrowNode(node, now)`, `parseEscrowList(accountObjects, now)`,
`parseRlusdTrustline(accountLines, issuer?)`, `parseRlusdBalance`, `parseHasRlusdTrustline`, `parseXrpBalance(accountInfo)`.
Decimal helpers: `toRlusd`, `toPlainDecimal` (expands `1.5e-7`), `divDecimal`, `dropsToXrpDecimal`.

`VaultSnapshot` / `LoanSnapshot` / `EscrowSnapshot` are the `@xrlp/shared` types (re-exported from `reads.ts`). Shared keeps
`LoanSnapshot.nextPaymentDueDate: string` required, so a paid-off loan reads `""`.

Ledger-pinned fetch primitives (shared with preflight): `fetchLedgerNow()` → `{ledgerIndex, closeTime}`;
`fetchEscrowNode(owner, seq, ledgerIndex?)` / `fetchAccountRoot(address, ledgerIndex?)` → raw node or `null` (not found);
`fetchAccountLines(account, issuer?, ledgerIndex?)` → raw `account_lines` result; `findTrustLine(result, currencyHex)` → raw line or `null`.

Observed on devnet while recording (2026-10-24): with tiny interest (50 %/yr over 90 s) `AssetsTotal` did not move at
`LoanSet` but rose by the interest at payoff (`1234.5 → 1234.501426940925`), so `sharePrice` went `1 → 1.000001`.

## Low-level modules (`src/`)

| File | Concern |
|---|---|
| `config.ts` | env (`XRPL_WS_URL`, `XRPL_FAUCET_HOST`, `WALLETS_FILE`, `DATA_DIR`), RLUSD hex code. Mainnet guard: a non-devnet URL/label denylist at load, and on every connect `server_info.network_id` must be devnet's **2** (`XRPL_NETWORK_ID` for another custom network ≥ 2; 0/1 never). `WALLETS_FILE` / `DATA_DIR` inside the repo must be git-ignored (under `.data/`, or named `wallets.json`), else the package refuses to load |
| `client.ts` | shared `Client` (+`reconnect`), `signAndSubmit`, `submitWithSigner`, `submitBlob`, `withAccountLock`, `ledgerTime`, `waitForLedgerTimeAfter`, `createdNodeId` |
| `submit.ts` | retry engine: per-account lock, result classification, `submitReliably`; XRPL-17 opt-in pipelined engine `submitPipelined` / `setSubmitMode` (network-free, see Submission semantics) |
| `errors.ts` | `XrplTxError`, `toErrorCode` → shared `ErrorCode`, `toLedgerError` / `withLedgerErrors` → shared `LedgerError` |
| `wallets.ts` | wallet store (`WALLETS_FILE`; written atomically, 0600), roles, pure `migrateWalletFile` / `rlusdTopUpPlan`, faucet funding, role resolution |
| `rlusd.ts` | issuer flags, trust lines, issue/pay, balances |
| `vault.ts` | closed-ended `VaultCreate`, deposit/withdraw, share balance, phase |
| `loan.ts` | `LoanBrokerSet` (default rates), `LoanBrokerCoverDeposit`, dual-signed `LoanSet` (platform account lock), multisig `LoanPay` |
| `lending-math.ts` | pure: broker-rate validation, cover sizing, origination/management fee, vault date math |
| `spv.ts` | `createSpv`, v2 `SignerListSet`, disable master, `submitMultisigned` (+ local quorum check), `getSpvInfo` |
| `condition.ts` | PREIMAGE-SHA-256 DER encoding + condition-format check (pure); no generation on the close path |
| `loan-close.ts` | XRPL-06: pure `planLoanClose` validation, `CloseValidationError`, `CloseLoanPartialError`; XRPL-13b: escrow mode, `validateEscrowSpecs`, partial-close `context`, pure resume planner (`planEscrowResume`) + ledger parsers |
| `batch.ts` | XRPL-13: XLS-56 Batch build/sign/submit (`submitBatch`, `mergeBatchSigners`), `createEscrowsAtomic`, `closeLoanAtomic` (`"full"` / `"escrows"` / `"auto"`, `isInnerLoanSetUnsupported`); XRPL-13b: inner lookups pinned to the Batch's ledger (`classifyInnerLookup`, `batchOutcome`), `BatchNotAppliedError`, metadata-checked escrows, `closePartialError` |
| `escrow.ts` | IOU `EscrowCreate` (SPV multisig), `EscrowFinish` (preflighted, rebuilt once if retriable), `EscrowCancel` (TooSoon-gated), wrong-fulfillment demo finish |
| `preflight.ts` | pre-reveal safety: `preflightFinish`, pure `evaluatePreflight`, `unsafe_release` mapping |
| `attest.ts` | memo attestations encode/decode |
| `credentials.ts` | `CredentialCreate` / `CredentialAccept` / status |
| `compliance.ts` | XRPL-08 high-level: fee, `grantCredential`, `createDomain`, `attest`, `submitSignedBlob` |
| `events.ts` | `TxResult` → shared `ChainEvent` |
| `reads.ts` | read models: vault/loan snapshots, escrows, balances, trust lines (pure parsers + thin fetches) |
| `prestage-types.ts` | XRPL-11: `PrestageFile` (`.data/prestage.json` shape for core), `parsePrestageFile`, pure `prestageVaultDates` |
| `default.ts` | XRPL-15: `LoanManage` impair / unimpair / default with a rippled-order guard, cover math, outcome parsers (pure + thin submit) |

## Demo + pre-staging (XRPL-11)

| Command | What | Time |
|---|---|---|
| `pnpm --filter @xrlp/xrpl demo` | CLI backup of the live demo, one fresh project: fee → `VERIFIED_BUILDER` → SPV (4 signers, q3) + private closed-ended vault + broker + cover → KYC'd deposits, investor3 `tecNO_AUTH` → LoanSet + 3 escrows → M1 audit + verdict + preflight + release attestation + `EscrowFinish` → M2 verdict `fail`, escrow stays → random fulfillment `tecCRYPTOCONDITION_ERROR` → M3 `EscrowCancel` → refund `LoanPay` (overpayment) → snapshots. Prints narration + a markdown tx table; run record in `.data/demo-run-*.json`. | ~5 min |
| `pnpm --filter @xrlp/xrpl prestage` (= `demo --prestage`) | Projects **A** ready (3 escrows open, 6×30-day loan), **B** stalled (M1 released, M2 `CancelAfter` already past, 12×30-day loan), **C** repaid (2 × 240 s loan, all released, loan paid off, past `RedemptionDate`). Writes `.data/prestage.json` (`PrestageFile`) + `.data/prestage-preimages.json` (secret, mode 600). | ~13 min |
| `pnpm --filter @xrlp/xrpl prestage --only A,B` | Re-stage a subset after a rehearsal; other projects are kept from the existing `prestage.json` (same issuer). | ~3–5 min |

Core (CORE-07) reads `.data/prestage.json` with `parsePrestageFile` (exported from `@xrlp/xrpl`): `projects.{A,B,C}` carry
project/milestone ids + amounts, `chain` (spv, vaultId, loanBrokerId, loanId, shareMptIssuanceId, domainId), escrows
`{milestoneId, owner, offerSequence, condition, cancelAfter, amount, state}`, SPV signers, investments, dates, a final
snapshot and every tx hash. Preimages are **only** in `.data/prestage-preimages.json` (`PrestagePreimagesFile`:
projectId → milestoneId → `{condition, preimage}`), the release-service stand-in until CORE-12 generates them;
`parsePrestageFile` rejects any file carrying a `preimage`/`fulfillment`/`seed` field. Env knobs: header of
`scripts/demo.ts` / `scripts/prestage.ts`. Devnet tx tables: `packages/xrpl/proof/xrpl-11-devnet-2026-10-25.md`.

## Stage check (XRPL-16)

`pnpm --filter @xrlp/xrpl stage:check` is the read-only go/no-go for the 30 minutes before the slot. It submits **no**
transaction and funds nothing (the faucet only gets a `HEAD`). It reads the wallet file (addresses only),
`.data/prestage.json`, `.data/prestage-preimages.json` and **one validated ledger**: every `account_info`,
`account_lines`, `account_objects` and `ledger_entry` is pinned to that ledger's index, and time is its `close_time`.
It prints one row per beat (~3 s) with the exact fix command:

| Beat | NO-GO unless it holds (WARN where marked) |
|---|---|
| every beat | devnet reachable, `network_id` 2, validated ledger fresh (WARN > 30 s, NO-GO > 120 s), `REQUIRED_AMENDMENTS` enabled in that ledger's Amendments object (SingleAssetVault, LendingProtocol, LendingProtocolV1_1, TokenEscrow, Credentials, PermissionedDomains, BatchV1_1; IDs = `amendmentId(name)`, SHA-512Half; `feature` only as a fallback); wallet file holds all 12 roles; `prestage.json` parses (`parsePrestageFile`) and belongs to the wallet file (network, RLUSD issuer, every role's account); the issuer exists. rippled ≠ 3.4.1 → WARN |
| D1 verified builder | builder holds an accepted `VERIFIED_BUILDER` and ≥ 250 RLUSD (fee); builder + platform can pay fees |
| D2 locked state | A: vault in Investment for the whole window, loan open, 3/3 escrows on the ledger and unexpired (each `CancelAfter` ≥ 300 s + window away, else WARN), SPV liquid ≤ 1 RLUSD (WARN); investor1/2 hold an accepted `KYC_INVESTOR`, investor3 none; platform RLUSD ≥ the first-loss cover of a live lock-terms on A's terms (`lockTermsCover`, XRPL-04 sizing: 3395.579039 for 30 000 @ 10 %, 6 × 30 d); faucet down → WARN |
| D3 release | A m1 through `evaluatePreflight`, exactly as the release service submits it (margin `RELEASE_MARGIN_S` = 300 s = `FINISH_LLS_MARGIN` 60 × 5 s), at ledger now **and** at now + window (only now → WARN): escrow present, destination = builder, Condition = `prestage.json`'s, builder RLUSD line (exists, headroom, not frozen/unauthorized), releaseService funded. A m1's preimage hashes to the on-ledger Condition. A's assigned inspector is one of ours and holds `VERIFIED_INSPECTOR`. aiAgent funded |
| D4 fraud held | A m2 still on the ledger and not expiring inside the window (WARN) |
| D5 ledger says no | `wrongFinishBlockers(evaluatePreflight(…))` for the platform's random-fulfillment `EscrowFinish` on A m2 is empty, now and at now + window |
| D6 stall → refund | B's `expired` escrow is still on the ledger and `cancelReadiness` is ok (cancellable inside the window → WARN); `planLoanPayment({amount: escrow + SPV RLUSD, source: "escrow_refund"})` accepts it **on time** now and at now + window (a LoanPay without `tfLoanLatePayment` after `NextPaymentDueDate` is `tecEXPIRED`; `GracePeriod` only delays a default); B's SPV can pay the fee; releaseService funded |
| withdraw (C) | C vault in Redemption (opens inside the window → WARN), `AssetsAvailable` > 0, every C investor holds shares (only some → WARN) |
| advisory, WARN only | `prestage.json` older than `--max-age-min`; preimages file mode ≠ 600; a missing or mismatched preimage for an escrow the demo doesn't release (A m2/m3, B); an unassigned inspector without `VERIFIED_INSPECTOR`; a role under 30 XRP (bootstrap's top-up line); trustee unfunded (multisig signers need no account) |

Exit **0 = no NO-GO** (GO, or GO with warnings), **1 = NO-GO**, **2** = the check itself failed. Flags: `--json` prints only
the `StageReport` JSON on stdout (use `pnpm -s --filter @xrlp/xrpl stage:check --json` so pnpm's banner stays off stdout),
`--verbose` lists every check, `--window-min=60` (`STAGE_WINDOW_MIN`; every time gate must hold until ledger now + window),
`--max-age-min=60` (`STAGE_MAX_AGE_MIN`), `--prestage <file>`, `--preimages <file>` (relative paths resolve against the repo
root, like `WALLETS_FILE`). Fix commands are exact and carry the env that picked the files
(`WALLETS_FILE=… pnpm --filter @xrlp/xrpl prestage --only B`). `fixes` merges them: one `bootstrap [--pre-verify-builder]`,
one `prestage --only <union>` (all three = plain `prestage`), then `chmod 600`. `suggestions` holds the warnings' fixes
that `fixes` doesn't already cover.

Secrets: `summarizePreimages` reduces the preimages file to `{storedCondition, derivedCondition}` per escrow (the preimage
never leaves that function), and `walletAddresses` reduces the wallet file to addresses. JSON parse errors of either file
are reported without content, since a parser excerpt would quote a seed or a preimage. A `StageSnapshot` holds no secret.

Pure core: `evaluateStage(snapshot, now, opts?) → StageReport` `{version: 1, ok, status, ledger, files, prestage, beats:
[{beat, title, status, details, fixes}], checks: [{id, status, message, beats, fix?}], fixes, suggestions, counts}`, with
offline tests (one fixture per NO-GO reason, `test/stage-check.test.ts`). `renderStageReport(report, {verbose})` renders the
table. All of it is exported from `@xrlp/xrpl`. Devnet runs (GO, a mangled preimage → D3 NO-GO, a rehearsal's
`EscrowCancel` of B → D6 NO-GO → `prestage --only B` → GO): `packages/xrpl/proof/xrpl-16-stage-check-2026-10-25.md`.
