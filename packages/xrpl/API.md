# @xrlp/xrpl — API

All XRPL devnet ledger operations for the project. Every tx-submitting call waits for validation,
throws `XrplTxError` (with the engine result + explorer link) unless `tesSUCCESS`, and returns
`TxResult { hash, explorerUrl, result, tx, meta }` and/or a shared `ChainEvent`.

```bash
pnpm --filter @xrlp/xrpl bootstrap      # fund + configure demo wallets -> .data/wallets.json (gitignored)
pnpm --filter @xrlp/xrpl demo           # full money path on devnet, prints a tx table with explorer links
pnpm --filter @xrlp/xrpl compliance     # XRPL-08 devnet proof: credentials x3, domain, private vault, fee, attestations
pnpm --filter @xrlp/xrpl test           # offline unit tests (condition encoding, attest memo/blob)
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
| `setupProjectOnChain(project, {subscriptionEndsAt?, redemptionAt?, coverDeposit?, lockSpv=true})` | SPV faucet + `TrustSet`, `SignerListSet`, `AccountSet asfDisableMaster`, `VaultCreate` (closed-ended), `LoanBrokerSet`, optional `LoanBrokerCoverDeposit` | `{spv, vaultId, loanBrokerId, shareMptIssuanceId, vaultPseudoAccount, subscriptionEndsAt, redemptionAt, events, txs, spvWallet}` |
| `depositToVault({projectId, vaultId, investor, amount})` | `VaultDeposit` | `{tx, event: vault_deposit}` |
| `closeLoanAndCreateEscrows(project, {conditions, builderAddress?, paymentTotal?, paymentIntervalS?, defaultCancelAfter?, waitForInvestmentPhase=true, spvSigners?, spvSingleKey?, allowOverpayment=true})` | `LoanSet` (platform signs, SPV multisig countersigns), then one `EscrowCreate` per milestone, back to back | `{loanId, loanSetTx, escrows: [{milestoneId, owner, offerSequence, condition, createTx, cancelAfter, amount, escrow}], events}` |
| `attestApproval({projectId, spv, milestoneId, role, signer, decision, notes?, verdictHash?, condition?})` | 1-drop `Payment` approver → SPV with a JSON memo (`xrlp/attestation/v1`) | `{tx, event: approval_attested, attestation}` |
| `releaseMilestone({projectId, milestoneId, escrow:{owner, offerSequence, condition}, fulfillment, amount?, submitter?})` | `EscrowFinish` | `{tx, event: escrow_finished}` |
| `cancelExpiredMilestone({projectId, milestoneId, escrow, cancelAfter?, wait?, amount?})` | `EscrowCancel` | `{tx, event: escrow_cancelled}` |
| `repayLoan({projectId, spv, loanId, amount?, mode?, signers?})` | `LoanPay` (SPV multisig: inspectorA + platform) | `{tx, event: loan_payment, amount, mode}` |
| `withdrawFromVault({projectId, vaultId, investor, amount})` | `VaultWithdraw` (Redemption phase only) | `{tx, event: vault_withdraw}` |
| `issueCredential({subject, type, uri?, accept=true, projectId?})` | `CredentialCreate` (platform) + `CredentialAccept` (subject). **Not idempotent**; prefer `grantCredential` | `{createTx, acceptTx, event: credential_issued}` |
| `getVaultStatus(vaultId)` / `getShareBalance(holder, mptId)` / `getLoan(loanId)` / `getSpvInfo(addr)` | reads | |

Defaults: `repayLoan` pays `PeriodicPayment + LoanServiceFee` and picks `late` if past due.
`closeLoanAndCreateEscrows` uses `milestone.cancelAfter` when set, otherwise `defaultCancelAfter`
(default: now + termDays). SPV quorum for `LoanSet`/`EscrowCreate` defaults to inspectorA (2) + aiAgent (1).

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
| `loan.ts` | `LoanBrokerSet`, `LoanBrokerCoverDeposit`, dual-signed `LoanSet`, multisig `LoanPay` |
| `spv.ts` | SPV account, `SignerListSet`, disable master, `multisignAndSubmit` |
| `condition.ts` | PREIMAGE-SHA-256 DER encoding (pure) |
| `escrow.ts` | IOU `EscrowCreate` (SPV multisig), `EscrowFinish`, `EscrowCancel` |
| `attest.ts` | `xrlp/attest/v1` memo encode/decode/validate, unsigned tx builder, signed-blob verify (+ v1 decoder) |
| `credentials.ts` | `CredentialCreate` / `CredentialAccept` / status / idempotent `ensureCredential`, `PermissionedDomainSet` (`ensureDomain`) |
| `compliance.ts` | XRPL-08 high-level: fee, `grantCredential`, `createDomain`, `attest`, `submitSignedBlob` |
| `events.ts` | `TxResult` → shared `ChainEvent` |
