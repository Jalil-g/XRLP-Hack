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
pnpm --filter @xrlp/xrpl compliance     # XRPL-08 devnet proof: credentials x3, domain, private vault, fee, attestations
pnpm --filter @xrlp/xrpl capture:reads  # re-record test/fixtures/*.json from fresh devnet objects (~2 min)
pnpm --filter @xrlp/xrpl stress         # devnet: 20 parallel Payments from one account, all tesSUCCESS
pnpm --filter @xrlp/xrpl spike:release  # XRPL-07 devnet proof: finish, wrong fulfillment, repay, cancel+refund, withdraw (~7 min)
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
| `closeLoanAndCreateEscrows(project, {conditions, cancelAfters?, builderAddress?, paymentTotal?, paymentIntervalS?, defaultCancelAfter?, waitForInvestmentPhase=true, spvSigners?, spvSingleKey?, allowOverpayment=true, originationFee?, originationFeePayer="builder"})` — see **Loan close (XRPL-06)** | validation first (nothing submitted on bad input), then (if needed) payer → SPV RLUSD `Payment` for the origination-fee shortfall, `LoanSet` with `LoanOriginationFee` (platform signs under its account lock, SPV multisig countersigns), then one `EscrowCreate` per milestone, back to back | `{loanId, loanSetTx, originationFee, originationFeeTopUpTx?, escrows: [{milestoneId, owner, offerSequence, condition, createTx, cancelAfter, amount, escrow}], txs, maturity, events}` |
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

### Loan close (XRPL-06): `closeLoanAndCreateEscrows`

Conditions are **generated by core's release service** (CORE-12, preimage unique per escrow, encrypted at rest) and passed in.
This package never generates preimages on the close path. `generateMilestoneCondition` is out of the public API (only a
`@deprecated` re-export remains so `scripts/demo.ts` compiles); tests and spikes use `test/support/conditions.ts` (`testConditionPair[s]`).

```ts
const close = await closeLoanAndCreateEscrows(project, {
  conditions,              // string[] by milestone index | Record<milestoneId, cond> | {milestoneId, condition}[]
  cancelAfters,            // optional ISO[] by milestone index (overrides milestone.cancelAfter / defaultCancelAfter)
  builderAddress: builder.address,
  waitForInvestmentPhase: false, // LedgerPort semantics: throw TooSoonError instead of waiting
});
// close.escrows[i] = { milestoneId, owner, offerSequence, condition, cancelAfter, createTx, amount, escrow } (≅ shared EscrowRef)
// close.txs = [LoanSet, EscrowCreate × N] (shared CloseResult.txs); close.maturity = ISO lower bound of loan maturity
```

Order: vault phase gate → `planLoanClose` (pure) + SPV quorum check → origination-fee top-up → `LoanSet` → `EscrowCreate × N`.
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

LoanSet terms: platform = `Account`, SPV = `Counterparty` (multisig, default platform + builder + trustee), `tfLoanOverpayment`,
no late fees, origination fee as in XRPL-04. `loanSet` itself also rejects `PaymentTotal < 2` / `InterestRate ≤ 0`.
If an `EscrowCreate` fails **after** LoanSet: `CloseLoanPartialError` (extends shared `LedgerError`, `code: "ledger_error"`,
`txResult`/`txHash` of the failed EscrowCreate) with `loanId`, `loanSetTx`, `created: CreatedEscrowRef[]`, `pending: milestoneId[]`
(failed one first). The caller can then create the pending escrows or repay. Pure validator: `planLoanClose(input)` (`src/loan-close.ts`,
offline tests in `test/loan-close.test.ts`). Devnet proof: `docs/xrpl-protocol-notes.md` §2c.

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

### Mapping to core's `LedgerPort` (origin/scaffold/core `packages/core/src/ports.ts`)

This package is the building block. The `LedgerPort` adapter (`packages/core/src/adapters/xrpl-ledger.ts`)
is a follow-up ticket. It maps 1:1:
- `setupProjectOnChain({project, builder, inspectors})` → `setupProjectOnChain(project, {...})`. Persist
  `subscriptionEndsAt`/`redemptionAt` (not in the shared `Project` contract yet).
- `closeLoanAndCreateEscrows({project, builder, conditions, cancelAfters})` → `closeLoanAndCreateEscrows(project, {conditions,
  cancelAfters, builderAddress: builder.address, waitForInvestmentPhase: false})`. Result `{loanId, escrows, txs}` is the shared
  `CloseResult` (`escrows[i]` ≅ `EscrowRef`). Map `CloseValidationError` → `validation`, `TooSoonError` → `too_soon`, `CloseLoanPartialError` → `ledger_error`.
- `attestApproval({project, milestone, role, signer, ...})` → `signer` may be the address.
- `releaseMilestone({project, milestone, fulfillment})` → `escrow: milestone.escrow`, `destination: builder.address`.
- `finishEscrow` / `tryFinishWithWrongFulfillment` / `cancelEscrow` (shared port) → `releaseMilestone` / `tryFinishWithWrongFulfillment` / `cancelExpiredMilestone`, return `.tx`.
- `cancelExpiredMilestone({project, milestone})` → `escrow: milestone.escrow`.
- `repayLoan({project, amount, source})` → `source: "builder"`: `builderPayToSpv({spv, amount})` then `repayLoan({spv, loanId, amount, source})`;
  `source: "escrow_refund"`: `repayLoan({spv, loanId, amount, source})` (mode picked automatically).
- `withdraw({project, investor, amount})` → `withdrawFromVault({vaultId, investor, amount})` (throws shared `TooSoonError`).
- `issueCredential` returns `projectId = "_platform"` (`PLATFORM_SCOPE`) by default.
- `getEscrow(owner, offerSequence)` → `getEscrowSnapshot` (shared `EscrowSnapshot | null`); `getVaultSnapshot` /
  `getLoanSnapshot` already return the shared types (`undefined` when the object is gone).
- Errors: wrap each method in `withLedgerErrors(...)` (or `throw toLedgerError(e)`) so callers only ever see the shared
  `LedgerError` / `TooSoonError`.

### Finish, cancel, repay, withdraw (XRPL-07)

| What | Behaviour |
|---|---|
| `finishEscrow` (`escrow.ts`) | `fulfillmentMatches` → `preflightFinish` (`lastLedgerOffset` 60 → margin to CancelAfter = max(120 s, 60 × 5 s) = 300 s) → `EscrowFinish` with preflight's Fee (sized for the fulfillment) + LastLedgerSequence. If the submit throws `retriable: true` (nothing applied), it **re-runs preflight and rebuilds once**. Short-lived spike escrows: pass `lastLedgerMargin: 20, marginS: 60`. |
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
| `config.ts` | env (`XRPL_WS_URL`, `XRPL_FAUCET_HOST`, `WALLETS_FILE`, `DATA_DIR`), mainnet guard, RLUSD hex code |
| `client.ts` | shared `Client` (+`reconnect`), `signAndSubmit`, `submitWithSigner`, `submitBlob`, `withAccountLock`, `ledgerTime`, `waitForLedgerTimeAfter`, `createdNodeId` |
| `submit.ts` | retry engine: per-account lock, result classification, `submitReliably` (network-free, see Submission semantics) |
| `errors.ts` | `XrplTxError`, `toErrorCode` → shared `ErrorCode`, `toLedgerError` / `withLedgerErrors` → shared `LedgerError` |
| `wallets.ts` | wallet store (`WALLETS_FILE`), roles, pure `migrateWalletFile` / `rlusdTopUpPlan`, faucet funding, role resolution |
| `rlusd.ts` | issuer flags, trust lines, issue/pay, balances |
| `vault.ts` | closed-ended `VaultCreate`, deposit/withdraw, share balance, phase |
| `loan.ts` | `LoanBrokerSet` (default rates), `LoanBrokerCoverDeposit`, dual-signed `LoanSet` (platform account lock), multisig `LoanPay` |
| `lending-math.ts` | pure: broker-rate validation, cover sizing, origination/management fee, vault date math |
| `spv.ts` | `createSpv`, v2 `SignerListSet`, disable master, `submitMultisigned` (+ local quorum check), `getSpvInfo` |
| `condition.ts` | PREIMAGE-SHA-256 DER encoding + condition-format check (pure); no generation on the close path |
| `loan-close.ts` | XRPL-06: pure `planLoanClose` validation, `CloseValidationError`, `CloseLoanPartialError` |
| `escrow.ts` | IOU `EscrowCreate` (SPV multisig), `EscrowFinish` (preflighted, rebuilt once if retriable), `EscrowCancel` (TooSoon-gated), wrong-fulfillment demo finish |
| `preflight.ts` | pre-reveal safety: `preflightFinish`, pure `evaluatePreflight`, `unsafe_release` mapping |
| `attest.ts` | memo attestations encode/decode |
| `credentials.ts` | `CredentialCreate` / `CredentialAccept` / status |
| `compliance.ts` | XRPL-08 high-level: fee, `grantCredential`, `createDomain`, `attest`, `submitSignedBlob` |
| `events.ts` | `TxResult` → shared `ChainEvent` |
| `reads.ts` | read models: vault/loan snapshots, escrows, balances, trust lines (pure parsers + thin fetches) |
