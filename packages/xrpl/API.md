# @xrlp/xrpl — API

All XRPL devnet ledger operations for the project. Every tx-submitting call waits for validation,
throws `XrplTxError` (with the engine result + explorer link) unless `tesSUCCESS`, and returns
`TxResult { hash, explorerUrl, result, tx, meta }` and/or a shared `ChainEvent`.

```bash
pnpm --filter @xrlp/xrpl bootstrap      # fund + configure demo wallets -> .data/wallets.json (gitignored)
pnpm --filter @xrlp/xrpl demo           # full money path on devnet, prints a tx table with explorer links
pnpm --filter @xrlp/xrpl test           # offline unit tests (condition encoding, lending math)
pnpm --filter @xrlp/xrpl spike:broker   # XRPL-04 devnet proof: rates, mandatory cover, origination fee
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
`.data/wallets.json`, or an xrpl `Wallet`. Roles: `issuer, platform, builder, investor1..3,
inspectorA, inspectorB, aiAgent`.

| Function | Txs | Returns |
|---|---|---|
| `bootstrapWallets({fresh?, investorRlusd?, platformRlusd?, log?})` | faucet, issuer `AccountSet` (DefaultRipple, AllowTrustLineLocking), `TrustSet`s, RLUSD `Payment`s | `{wallets, txs}` (idempotent) |
| `setupProjectOnChain(project, {subscriptionEndsAt?, redemptionAt?, paymentTotal?, paymentIntervalS?, coverDeposit?, coverRateMinimum?, coverRateLiquidation?, managementFeeRate?, lockSpv=true})` | SPV faucet + `TrustSet`, `SignerListSet`, `AccountSet asfDisableMaster`, `VaultCreate` (closed-ended, `AssetsMaximum = principal`), `LoanBrokerSet` (cover rates + management fee), **mandatory** `LoanBrokerCoverDeposit` | `{spv, vaultId, loanBrokerId, shareMptIssuanceId, vaultPseudoAccount, subscriptionEndsAt, redemptionAt, cover, coverEvent, events, txs, spvWallet}` |
| `depositToVault({projectId, vaultId, investor, amount})` | `VaultDeposit` | `{tx, event: vault_deposit}` |
| `closeLoanAndCreateEscrows(project, {conditions, builderAddress?, paymentTotal?, paymentIntervalS?, defaultCancelAfter?, waitForInvestmentPhase=true, spvSigners?, spvSingleKey?, allowOverpayment=true, originationFee?, originationFeePayer="builder"})` | (if needed) payer → SPV RLUSD `Payment` for the origination-fee shortfall, `LoanSet` with `LoanOriginationFee` (platform signs, SPV multisig countersigns), then one `EscrowCreate` per milestone, back to back | `{loanId, loanSetTx, originationFee, originationFeeTopUpTx?, escrows: [{milestoneId, owner, offerSequence, condition, createTx, cancelAfter, amount, escrow}], events}` |
| `attestApproval({projectId, spv, milestoneId, role, signer, decision, notes?, verdictHash?, condition?})` | 1-drop `Payment` approver → SPV with a JSON memo (`xrlp/attestation/v1`) | `{tx, event: approval_attested, attestation}` |
| `releaseMilestone({projectId, milestoneId, escrow:{owner, offerSequence, condition}, fulfillment, amount?, submitter?})` | `EscrowFinish` | `{tx, event: escrow_finished}` |
| `cancelExpiredMilestone({projectId, milestoneId, escrow, cancelAfter?, wait?, amount?})` | `EscrowCancel` | `{tx, event: escrow_cancelled}` |
| `repayLoan({projectId, spv, loanId, amount?, mode?, signers?})` | `LoanPay` (SPV multisig: inspectorA + platform) | `{tx, event: loan_payment, amount, mode}` |
| `withdrawFromVault({projectId, vaultId, investor, amount})` | `VaultWithdraw` (Redemption phase only) | `{tx, event: vault_withdraw}` |
| `issueCredential({subject, type, uri?, accept=true, projectId?})` | `CredentialCreate` (platform) + `CredentialAccept` (subject) | `{createTx, acceptTx, event: credential_issued}` |
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
(default: now + termDays). SPV quorum for `LoanSet`/`EscrowCreate` defaults to inspectorA (2) + aiAgent (1).

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
| `client.ts` | shared `Client`, `signAndSubmit`, `submitBlob`, `ledgerTime`, `waitForLedgerTimeAfter`, `createdNodeId` |
| `wallets.ts` | `.data/wallets.json` store, faucet funding, role resolution |
| `rlusd.ts` | issuer flags, trust lines, issue/pay, balances |
| `vault.ts` | closed-ended `VaultCreate`, deposit/withdraw, share balance, phase |
| `loan.ts` | `LoanBrokerSet` (default rates), `LoanBrokerCoverDeposit`, dual-signed `LoanSet`, multisig `LoanPay` |
| `lending-math.ts` | pure: broker-rate validation, cover sizing, origination/management fee, vault date math |
| `spv.ts` | SPV account, `SignerListSet`, disable master, `multisignAndSubmit` |
| `condition.ts` | PREIMAGE-SHA-256 DER encoding (pure) |
| `escrow.ts` | IOU `EscrowCreate` (SPV multisig), `EscrowFinish`, `EscrowCancel` |
| `attest.ts` | memo attestations encode/decode |
| `credentials.ts` | `CredentialCreate` / `CredentialAccept` / status |
| `events.ts` | `TxResult` → shared `ChainEvent` |
