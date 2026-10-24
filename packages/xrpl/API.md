# @xrlp/xrpl — API

All XRPL devnet ledger operations for the project. Every tx-submitting call waits for validation,
throws `XrplTxError` (with the engine result + explorer link) unless `tesSUCCESS`, and returns
`TxResult { hash, explorerUrl, result, tx, meta }` and/or a shared `ChainEvent`.

```bash
pnpm --filter @xrlp/xrpl bootstrap      # fund + configure demo wallets -> $WALLETS_FILE (default .data/wallets.json, gitignored); idempotent
pnpm --filter @xrlp/xrpl demo           # full money path on devnet, prints a tx table with explorer links
pnpm --filter @xrlp/xrpl test           # offline unit tests (no network)
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
| `setupProjectOnChain(project, {subscriptionEndsAt?, redemptionAt?, coverDeposit?, lockSpv=true, spvSigners?: {builder?, inspector?, platform?, trustee?}})` | SPV faucet + `TrustSet`, `SignerListSet` {platform, builder, inspector, trustee} w1 quorum 3, `AccountSet asfDisableMaster`, `VaultCreate` (closed-ended), `LoanBrokerSet`, optional `LoanBrokerCoverDeposit` | `{spv, vaultId, loanBrokerId, shareMptIssuanceId, vaultPseudoAccount, subscriptionEndsAt, redemptionAt, events, txs, spvWallet}` |
| `depositToVault({projectId, vaultId, investor, amount})` | `VaultDeposit` | `{tx, event: vault_deposit}` |
| `closeLoanAndCreateEscrows(project, {conditions, builderAddress?, paymentTotal?, paymentIntervalS?, defaultCancelAfter?, waitForInvestmentPhase=true, spvSigners?, spvSingleKey?, allowOverpayment=true})` | `LoanSet` (platform signs, SPV multisig countersigns), then one `EscrowCreate` per milestone, back to back | `{loanId, loanSetTx, escrows: [{milestoneId, owner, offerSequence, condition, createTx, cancelAfter, amount, escrow}], events}` |
| `attestApproval({projectId, spv, milestoneId, role, signer, decision, notes?, verdictHash?, condition?})` | 1-drop `Payment` approver → SPV with a JSON memo (`xrlp/attestation/v1`) | `{tx, event: approval_attested, attestation}` |
| `releaseMilestone({projectId, milestoneId, escrow:{owner, offerSequence, condition}, fulfillment, amount?, submitter?})` | `EscrowFinish` | `{tx, event: escrow_finished}` |
| `cancelExpiredMilestone({projectId, milestoneId, escrow, cancelAfter?, wait?, amount?})` | `EscrowCancel` | `{tx, event: escrow_cancelled}` |
| `repayLoan({projectId, spv, loanId, amount?, mode?, signers?})` | `LoanPay` (SPV multisig, default platform + builder + trustee) | `{tx, event: loan_payment, amount, mode}` |
| `withdrawFromVault({projectId, vaultId, investor, amount})` | `VaultWithdraw` (Redemption phase only) | `{tx, event: vault_withdraw}` |
| `issueCredential({subject, type, uri?, accept=true, projectId?})` | `CredentialCreate` (platform) + `CredentialAccept` (subject) | `{createTx, acceptTx, event: credential_issued}` |
| `getVaultStatus(vaultId)` / `getShareBalance(holder, mptId)` / `getLoan(loanId)` / `getSpvInfo(addr)` | reads | |

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
| `loan.ts` | `LoanBrokerSet`, `LoanBrokerCoverDeposit`, dual-signed `LoanSet`, multisig `LoanPay` |
| `spv.ts` | `createSpv`, v2 `SignerListSet`, disable master, `submitMultisigned` (+ local quorum check), `getSpvInfo` |
| `condition.ts` | PREIMAGE-SHA-256 DER encoding (pure) |
| `escrow.ts` | IOU `EscrowCreate` (SPV multisig), `EscrowFinish`, `EscrowCancel` |
| `attest.ts` | memo attestations encode/decode |
| `credentials.ts` | `CredentialCreate` / `CredentialAccept` / status |
| `events.ts` | `TxResult` → shared `ChainEvent` |
