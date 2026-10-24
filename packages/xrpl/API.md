# @xrlp/xrpl — API

All XRPL devnet ledger operations for the project. Every tx-submitting call waits for validation,
throws `XrplTxError` (with the engine result + explorer link) unless `tesSUCCESS`, and returns
`TxResult { hash, explorerUrl, result, tx, meta }` and/or a shared `ChainEvent`.

```bash
pnpm --filter @xrlp/xrpl bootstrap      # fund + configure demo wallets -> $WALLETS_FILE (default .data/wallets.json, gitignored); idempotent
pnpm --filter @xrlp/xrpl demo           # full money path on devnet, prints a tx table with explorer links
pnpm --filter @xrlp/xrpl test           # offline unit tests (condition encoding, lending math, wallet-file migration)
pnpm --filter @xrlp/xrpl spike:broker   # XRPL-04 devnet proof: rates, mandatory cover, origination fee
pnpm --filter @xrlp/xrpl compliance     # XRPL-08 devnet proof: credentials x3, domain, private vault, fee, attestations
pnpm --filter @xrlp/xrpl capture:reads  # re-record test/fixtures/*.json from fresh devnet objects (~2 min)
pnpm --filter @xrlp/xrpl stress         # devnet: 20 parallel Payments from one account, all tesSUCCESS
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
  `XRPL_LLS_MARGIN`). Pass `{ lastLedgerMargin: 60 }` for txs that may take longer (EscrowFinish).
- **Retries are bounded** (`maxAttempts` default 5, exponential backoff 0.5s → 4s):

  | Preliminary / error | Action |
  |---|---|
  | `tesSUCCESS`, `terQUEUED`, `tefALREADY`, other `ter*`, `tec*` | wait for the validated result (`tec*` final → throw, never retried) |
  | `telINSUF_FEE_P`, `telCAN_NOT_QUEUE*`, RPC `tooBusy`/`noNetwork`/`noCurrent`/`slowDown` | back off, re-sign with the **same Sequence** and a fresh Fee (pre-signed blob: resubmit the same blob) |
  | websocket disconnect / timeout | reconnect the shared client, resubmit the **same blob** (same hash, so it's idempotent) |
  | `LastLedgerSequence` passed and `tx` reports `searched_all` with no hit | provably not applied → re-sign with the same Sequence (pre-signed: throw `retriable`) |
  | `tefPAST_SEQ` | if this hash may have been sent earlier, wait and look it up (an earlier submit probably applied it); otherwise re-autofill a fresh Sequence |
  | `tem*`, other `tef*`/`tel*` | throw at once, never retried |

  A new blob is only signed after the old one provably **cannot** apply. Same-Sequence re-signs are mutually exclusive
  with the original, so there is no double spend. A validated hash is never resubmitted.
- **Errors.** `XrplTxError { txType, engineResult, hash?, explorerUrl?, retriable }` (the constructor is backwards
  compatible). `retriable` is true only when nothing was applied and a re-prepared attempt may succeed.
  `toErrorCode(e)` maps to the docs/05-api.md `ErrorCode`: `tecTOO_SOON → too_soon`,
  `tecNO_ENTRY/tecNO_TARGET/tecNO_DST/tecOBJECT_NOT_FOUND/tecNO_LINE`, plus RPC `entryNotFound`/`actNotFound` → `not_found`,
  `tem* → validation`, everything else `ledger_error`.
- `XRPL_SUBMIT_LOG=1` prints every retry decision with its explorer link.

**Devnet proof** (`pnpm --filter @xrlp/xrpl stress`, 2026-10-24, fresh faucet wallets): 20 parallel RLUSD `Payment`s
from one account → **20/20 `tesSUCCESS`**, Sequences 6390192..6390211 contiguous, 0 retries, 128.6s.
Same burst via raw xrpl.js `autofill`+`submitAndWait` (`STRESS_BASELINE=1`) → 1 `tesSUCCESS`, **19 `tefPAST_SEQ`**.
First/last: https://devnet.xrpl.org/transactions/93F70A01CAA36E7A6B318B61B31C52313AD8B8C7BFAF484C6804BFA1A29CD79F ·
https://devnet.xrpl.org/transactions/AB03F78A5862CCC25B601DB65368FBEF1D839A7914D743D0F6282DD52ADA2EBC

## High-level API (what `@xrlp/core` calls)

Wallet arguments (`WalletRef`) accept a role name (`"investor1"`), a demo address from
`.data/wallets.json`, or an xrpl `Wallet`.

### Roles (Direction v2, `WALLET_ROLES`)

| Role | RLUSD trust line | Bootstrap RLUSD | Used for |
|---|---|---|---|
| `issuer` | — (issuer) | — | mock RLUSD; `DefaultRipple` + `AllowTrustLineLocking` |
| `platform` | ✔ | 25 000 (`platformRlusd`) | vault + broker owner, first-loss cover, credential issuer, receives verification fees, SPV signer |
| `releaseService` | — | — | submits `EscrowFinish` / `EscrowCancel`, `release` attestations (XRP fees only) |
| `builder` | ✔ | 1 000 (`builderRlusd`, ≥ 250 fee) | pays verification fee, receives milestone payouts, SPV signer |
| `investor1..3` | ✔ | 50 000 each (`investorRlusd`) | vault depositors |
| `inspector1..3` | — | — | panel; audit attestations (1-drop XRP); the project's assigned one is an SPV signer (default `inspector1`) |
| `aiAgent` | — | — | verdict attestations; **not** an SPV signer |
| `trustee` | — | — | 4th SPV signer (investor rep) |

Trust lines only for `RLUSD_HOLDERS` (`platform, builder, investor1..3`); add a role there if it must ever hold RLUSD.
Bootstrap is idempotent: it reuses `WALLETS_FILE`, generates only missing roles, renames v1 roles
(`inspectorA → inspector1`, `inspectorB → inspector2`, same account), moves unknown roles to `retired` (seeds kept),
tops up XRP below 30, skips existing issuer flags / trust lines, and mints only up to the targets. A second run submits 0 txs.

| Function | Txs | Returns |
|---|---|---|
| `bootstrapWallets({fresh?, investorRlusd?, platformRlusd?, builderRlusd?, log?})` | faucet, issuer `AccountSet` (DefaultRipple, AllowTrustLineLocking), `TrustSet`s (RLUSD holders), RLUSD `Payment`s | `{wallets, txs}` (idempotent, 2nd run `txs = []`) |
| `setupProjectOnChain(project, {subscriptionEndsAt?, redemptionAt?, paymentTotal?, paymentIntervalS?, coverDeposit?, coverRateMinimum?, coverRateLiquidation?, managementFeeRate?, lockSpv=true, spvSigners?: {builder?, inspector?, platform?, trustee?}})` | SPV faucet + `TrustSet`, `SignerListSet` {platform, builder, inspector, trustee} w1 quorum 3, `AccountSet asfDisableMaster`, `VaultCreate` (closed-ended, `AssetsMaximum = principal`), `LoanBrokerSet` (cover rates + management fee), **mandatory** `LoanBrokerCoverDeposit` | `{spv, vaultId, loanBrokerId, shareMptIssuanceId, vaultPseudoAccount, subscriptionEndsAt, redemptionAt, cover, coverEvent, events, txs, spvWallet}` |
| `depositToVault({projectId, vaultId, investor, amount})` | `VaultDeposit` | `{tx, event: vault_deposit}` |
| `closeLoanAndCreateEscrows(project, {conditions, builderAddress?, paymentTotal?, paymentIntervalS?, defaultCancelAfter?, waitForInvestmentPhase=true, spvSigners?, spvSingleKey?, allowOverpayment=true, originationFee?, originationFeePayer="builder"})` | (if needed) payer → SPV RLUSD `Payment` for the origination-fee shortfall, `LoanSet` with `LoanOriginationFee` (platform signs, SPV multisig countersigns), then one `EscrowCreate` per milestone, back to back | `{loanId, loanSetTx, originationFee, originationFeeTopUpTx?, escrows: [{milestoneId, owner, offerSequence, condition, createTx, cancelAfter, amount, escrow}], events}` |
| `attestApproval({projectId, spv, milestoneId, role, signer, decision, notes?, verdictHash?, condition?})` | 1-drop `Payment` approver → SPV with a JSON memo (`xrlp/attestation/v1`) | `{tx, event: approval_attested, attestation}` |
| `releaseMilestone({projectId, milestoneId, escrow:{owner, offerSequence, condition}, fulfillment, amount?, submitter?})` | `EscrowFinish` | `{tx, event: escrow_finished}` |
| `cancelExpiredMilestone({projectId, milestoneId, escrow, cancelAfter?, wait?, amount?})` | `EscrowCancel` | `{tx, event: escrow_cancelled}` |
| `repayLoan({projectId, spv, loanId, amount?, mode?, signers?})` | `LoanPay` (SPV multisig, default platform + builder + trustee) | `{tx, event: loan_payment, amount, mode}` |
| `withdrawFromVault({projectId, vaultId, investor, amount})` | `VaultWithdraw` (Redemption phase only) | `{tx, event: vault_withdraw}` |
| `issueCredential({subject, type, uri?, accept=true, projectId?})` | `CredentialCreate` (platform) + `CredentialAccept` (subject). **Not idempotent**; prefer `grantCredential` | `{createTx, acceptTx, event: credential_issued}` |
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
- **`cover_deposited` event:** returned as `setup.coverEvent` (+ `setup.cover` details). It is added to `setup.events`
  only once `@xrlp/shared` `ChainEvent.kind` includes `cover_deposited` (runtime check, TODO(#53)), so core's strict
  `ChainEvent` parsing never sees an unknown kind.
- **Origination fee vs escrows:** `LoanSet` sends `principal − fee` to the SPV, but milestone escrows sum to the full
  principal. `closeLoanAndCreateEscrows` therefore has `originationFeePayer` (default demo `builder`) pay the shortfall
  into the SPV just before `LoanSet` ("points paid at closing"), and fails fast with a clear error if the payer lacks
  the RLUSD. Pass `originationFee: "0"` to skip the fee.

Defaults: `repayLoan` pays `PeriodicPayment + LoanServiceFee` and picks `late` if past due.
`closeLoanAndCreateEscrows` uses `milestone.cancelAfter` when set, otherwise `defaultCancelAfter`
(default: now + termDays). SPV quorum for `LoanSet`/`EscrowCreate`/`LoanPay` defaults to **platform + builder + trustee**
(`defaultSpvSignerWallets()`). Those three are the same for every project whichever inspector was assigned. Pass
`spvSigners` / `signers` to sign with the inspector instead. Any 3 of the 4 work. The AI key is never a signer.

### SPV (XRPL-05)

| Function | What |
|---|---|
| `createSpv({issuer, signers: {platform, builder, inspector, trustee}, lock=true})` | fund, RLUSD `TrustSet`, `SignerListSet` w1 ×4 quorum 3, `asfDisableMaster` → `{address, wallet, txs}` |
| `lockSpv(wallet, signers)` / `lockSpvAccount(wallet, partialSigners?)` | `SignerListSet` + `asfDisableMaster` (fallback path: lock after LoanSet). `lockSpvAccount` fills gaps from the demo roles via `spvSignersFor()` |
| `submitMultisigned(tx, signerWallets, {checkQuorum=true})` | autofill with `signers.length`, multisign, submit. Checks the account's on-ledger SignerList first and throws `XrplTxError` `tefBAD_QUORUM` / `tefBAD_SIGNATURE` immediately (xrpl.js would otherwise wait ~1 min for a `tef`). `multisignAndSubmit` = compat alias |
| `multisignBlob(tx, signerWallets)` | `{blob, hash}` without submitting |
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
| `createDomain({platform?, types=["KYC_INVESTOR"]})` | `PermissionedDomainSet`, AcceptedCredentials = [platform, KYC_INVESTOR]. Idempotent (reuses an identical owned domain) | `{domainId, tx?}` |
| `createVault({..., domainId, nonTransferableShares: true})` (`vault.ts`) | `VaultCreate` + `tfVaultPrivate` + `DomainID` (+ `tfVaultShareNonTransferable`) | as before |
| `attest({signer, spv, memo, projectId?})` | 1-drop XRP `Payment` signer → SPV, memo `xrlp/attest/v1` | `{tx, memo, event}` |
| `submitSignedBlob(blob, {expectSigner?, expectSpv?, projectId?})` | submits an inspector-app-signed attestation after `verifyAttestBlob` | `{tx, memo, signer, event}` |

`CredentialType = "VERIFIED_BUILDER" | "VERIFIED_INSPECTOR" | "KYC_INVESTOR"`, on-ledger as hex ASCII (`credentialTypeHex`).
Non-KYC (or KYC issued but not accepted) `VaultDeposit` into a private vault → **`tecNO_AUTH`** (on-ledger).

`AttestMemo = { v:1, kind: "audit"|"verdict"|"decision"|"release", milestoneId, hash /*sha256 hex*/, decision?, reason? }`
(≤ 900 bytes JSON). Event kinds: audit → `audit_attested`, verdict → `verdict_attested`, decision → `decision_attested`,
release → `approval_attested` (no v2 kind yet). The v2 kinds are cast until shared v2 (#53) merges (`TODO(#53)`).

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

### Escrow gating (inspector-held preimage, no Shamir)

```ts
import { generateMilestoneCondition, fulfillmentMatches } from "@xrlp/xrpl";
// INSPECTOR side (pure, offline). One per escrow and never reused.
const { condition, fulfillment } = generateMilestoneCondition(); // A0258020…810120 / A0228020…
// Only `condition` goes to closeLoanAndCreateEscrows. The platform never stores `fulfillment`.
// At release, the inspector hands over `fulfillment` and releaseMilestone checks it and submits EscrowFinish.
```

AI + inspector + platform approvals go on-chain as memo attestations (an audit trail), but they are
**not** release keys. Trust assumption: whoever holds the fulfillment can release to the builder (and
only to the builder). Signers can't redirect escrowed funds.

### Pre-reveal safety: `preflightFinish` (XRPL-14)

A failed `EscrowFinish` carrying the right fulfillment (`tecNO_LINE`, past `CancelAfter`, ...) **publishes the preimage
while the escrow stays open**. So `finishEscrow` / `releaseMilestone` call `preflightFinish` first and throw
`UnsafeReleaseError` (`code: "unsafe_release"`, docs/05-api.md) without submitting anything. Pass `skipPreflight: true` only in negative spikes.

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
(36 drops on devnet). The pure core `evaluatePreflight(snapshot, now)` is unit-tested offline. Devnet proof:
`pnpm --filter @xrlp/xrpl spike:preflight` (a builder with no trust line is refused and nothing is submitted, then it finishes once the line exists; a short-`CancelAfter` escrow is refused inside the margin).

### Mapping to core's `LedgerPort` (origin/scaffold/core `packages/core/src/ports.ts`)

This package is the building block. The `LedgerPort` adapter (`packages/core/src/adapters/xrpl-ledger.ts`)
is a follow-up ticket. It maps 1:1:
- `setupProjectOnChain({project, builder, inspectors})` → `setupProjectOnChain(project, {...})`. Persist
  `subscriptionEndsAt`/`redemptionAt` (not in the shared `Project` contract yet).
- `closeLoanAndCreateEscrows({project, builder, conditions})` → pass `conditions` (array accepted) +
  `builderAddress: builder.address`. `escrows[i]` already has `{milestoneId, owner, offerSequence, condition, createTx}`.
- `attestApproval({project, milestone, role, signer, ...})` → `signer` may be the address.
- `releaseMilestone({project, milestone, fulfillment})` → `escrow: milestone.escrow`.
- `cancelExpiredMilestone({project, milestone})` → `escrow: milestone.escrow`.
- `repayLoan({project, amount, source})` → `repayLoan({spv, loanId, amount, mode: amount > periodic ? "overpayment" : undefined})`.
- `issueCredential` returns `projectId = "_platform"` (`PLATFORM_SCOPE`) by default.

## Read models (`src/reads.ts`, XRPL-09)

Each read = a **pure parser** (raw rippled JSON → model, unit-tested on recorded devnet responses in
`test/fixtures/`) + a **thin fetch** that reads one validated ledger. "Now" is that ledger's `close_time`.
RLUSD values are shared `Rlusd` strings (plain decimal, ≤ 6 decimals, **truncated**). Fields rippled omits
(zero/default) read as `"0"` / `0`.

| Function | Returns | Notes |
|---|---|---|
| `getVaultSnapshot(vaultId)` | `VaultSnapshot \| undefined` | `{assetsTotal, assetsAvailable, sharesOutstanding, sharePrice, subscriptionDate, redemptionDate, phase}` (05-api §2). `sharesOutstanding` = raw share-MPT units (`OutstandingAmount`); `sharePrice` = `assetsTotal / (sharesOutstanding / 10^Vault.Scale)`, 6 dp, `"1"` with no shares. `phase` from ledger time: `subscription` (now ≤ SubscriptionDate), `investment`, `redemption` (now ≥ RedemptionDate); an open-ended vault reads as `subscription`. |
| `getLoanSnapshot(loanId)` | `LoanSnapshot \| undefined` | `{principalOutstanding, totalValueOutstanding, periodicPayment, paymentRemaining, nextPaymentDueDate}`. A paid-off loan has `paymentRemaining 0`, outstanding `"0"`, `nextPaymentDueDate ""` (rippled drops the field). |
| `getEscrow(owner, offerSequence)` | `EscrowView \| undefined` | `ledger_entry {escrow:{owner, seq}}`. `undefined` = consumed (finished/cancelled) or never created. `{index, owner, offerSequence, destination, currency: "RLUSD"\|"XRP"\|…, issuer?, amount, condition?, cancelAfter?, finishAfter? (ISO + *Ripple), status: "open"\|"expired", finishable, cancellable}`. `expired` = now > CancelAfter (finish fails, anyone can cancel). |
| `listEscrowsParsed(owner)` | `EscrowView[]` | Escrows **owned** by `owner` (incoming ones dropped), paginated `account_objects`. `offerSequence` comes from `Escrow.Sequence` (present on devnet). |
| `getBalance(account, "RLUSD"\|"XRP", {issuer?})` | decimal string | RLUSD from `account_lines` (any RLUSD line, or the given issuer); XRP = total incl. reserve. Unfunded / no line → `"0"`; issuer-side negative → `"0"`. |
| `hasRlusdTrustline(account, issuer?)` | `boolean` | Line exists, own limit > 0, not frozen by the issuer. For `preflightFinish` (XRPL-14). |

Pure parsers (no network; feed them recorded or fetched `result` objects, rippled error payloads like
`{error:"entryNotFound"}` included): `parseVaultSnapshot({ledger, vault, shareIssuance})`, `parseLoanSnapshot(result)`,
`parseEscrow(result, now, seq?)`, `parseEscrowNode(node, now)`, `parseEscrowList(accountObjects, now)`,
`parseRlusdTrustline(accountLines, issuer?)`, `parseRlusdBalance`, `parseHasRlusdTrustline`, `parseXrpBalance(accountInfo)`.
Decimal helpers: `toRlusd`, `toPlainDecimal` (expands `1.5e-7`), `divDecimal`, `dropsToXrpDecimal`.

`VaultSnapshot` / `LoanSnapshot` are defined locally in `reads.ts` (mirror of 05-api §2) until they land in `@xrlp/shared`.

Observed on devnet while recording (2026-10-24): with tiny interest (50 %/yr over 90 s) `AssetsTotal` did not move at
`LoanSet` but rose by the interest at payoff (`1234.5 → 1234.501426940925`), so `sharePrice` went `1 → 1.000001`.

## Low-level modules (`src/`)

| File | Concern |
|---|---|
| `config.ts` | env (`XRPL_WS_URL`, `XRPL_FAUCET_HOST`, `WALLETS_FILE`, `DATA_DIR`), mainnet guard, RLUSD hex code |
| `client.ts` | shared `Client` (+`reconnect`), `signAndSubmit`, `submitWithSigner`, `submitBlob`, `withAccountLock`, `ledgerTime`, `waitForLedgerTimeAfter`, `createdNodeId` |
| `submit.ts` | retry engine: per-account lock, result classification, `submitReliably` (network-free, see Submission semantics) |
| `errors.ts` | `XrplTxError`, `toErrorCode` → API `ErrorCode` |
| `wallets.ts` | wallet store (`WALLETS_FILE`), roles, pure `migrateWalletFile` / `rlusdTopUpPlan`, faucet funding, role resolution |
| `rlusd.ts` | issuer flags, trust lines, issue/pay, balances |
| `vault.ts` | closed-ended `VaultCreate`, deposit/withdraw, share balance, phase |
| `loan.ts` | `LoanBrokerSet` (default rates), `LoanBrokerCoverDeposit`, dual-signed `LoanSet`, multisig `LoanPay` |
| `lending-math.ts` | pure: broker-rate validation, cover sizing, origination/management fee, vault date math |
| `spv.ts` | `createSpv`, v2 `SignerListSet`, disable master, `submitMultisigned` (+ local quorum check), `getSpvInfo` |
| `condition.ts` | PREIMAGE-SHA-256 DER encoding (pure) |
| `escrow.ts` | IOU `EscrowCreate` (SPV multisig), `EscrowFinish` (preflighted), `EscrowCancel` |
| `preflight.ts` | pre-reveal safety: `preflightFinish`, pure `evaluatePreflight`, `unsafe_release` mapping |
| `attest.ts` | memo attestations encode/decode |
| `credentials.ts` | `CredentialCreate` / `CredentialAccept` / status |
| `compliance.ts` | XRPL-08 high-level: fee, `grantCredential`, `createDomain`, `attest`, `submitSignedBlob` |
| `events.ts` | `TxResult` → shared `ChainEvent` |
| `reads.ts` | read models: vault/loan snapshots, escrows, balances, trust lines (pure parsers + thin fetches) |
