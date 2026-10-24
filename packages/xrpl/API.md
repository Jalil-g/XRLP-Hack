# @xrlp/xrpl — API

All XRPL devnet ledger operations for the project. Every tx-submitting call waits for validation,
throws `XrplTxError` (with the engine result + explorer link) unless `tesSUCCESS`, and returns
`TxResult { hash, explorerUrl, result, tx, meta }` and/or a shared `ChainEvent`.

```bash
pnpm --filter @xrlp/xrpl bootstrap      # fund + configure demo wallets -> $WALLETS_FILE (default .data/wallets.json, gitignored); idempotent
pnpm --filter @xrlp/xrpl demo           # full money path on devnet, prints a tx table with explorer links
pnpm --filter @xrlp/xrpl test           # offline unit tests (no network)
pnpm --filter @xrlp/xrpl capture:reads  # re-record test/fixtures/*.json from fresh devnet objects (~2 min)
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
| `client.ts` | shared `Client`, `signAndSubmit`, `submitBlob`, `ledgerTime`, `waitForLedgerTimeAfter`, `createdNodeId` |
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
| `reads.ts` | read models: vault/loan snapshots, escrows, balances, trust lines (pure parsers + thin fetches) |
