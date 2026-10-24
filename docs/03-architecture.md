# 03 — Technical Architecture

> Markers: **[Verified]** = checked against the spec or devnet, **[Changed]** = design changed after protocol review.
> Evidence and citations are in `docs/xrpl-protocol-notes.md`.

Network: **XRPL Devnet** (`wss://s.devnet.rippletest.net:51233`). Verified 2026-10-24: `SingleAssetVault`,
`LendingProtocol`, **`LendingProtocolV1_1`**, `TokenEscrow`, `Credentials`, `PermissionedDomains`, `MultiSignReserve`,
`ExpandedSignerList`, `BatchV1_1` are all **enabled on devnet** (rippled 3.4.1; reserves 1 / 0.2 XRP; base fee 1 drop;
faucet 100 XRP). Vault + LendingProtocol are **NOT** enabled on testnet. **[Verified]**

Library: `xrpl` (xrpl.js) **5.3.0**. It has typed `VaultCreate/Deposit/Withdraw` (including `VaultKind`, `SubscriptionDate`,
`RedemptionDate`), `LoanBrokerSet`, `LoanBrokerCoverDeposit`, `LoanSet`, `LoanPay`, `LoanManage`,
`EscrowCreate/Finish/Cancel`, `SignerListSet`, `Batch`, `Credential*`, `PermissionedDomainSet`, plus
`signLoanSetByCounterparty` / `combineLoanSetCounterpartySigners`. **[Verified in source]**

## Key protocol facts that shaped the design

1. XLS-66 `LoanSet` sends the **entire principal to the borrower at once**. There are no draws or tranches.
   So staged release comes from **escrow**, and the borrower is a **project account** (SPV), not the builder. **[Verified]**
2. **[Changed]** Under `LendingProtocolV1_1` (live on devnet), a LoanBroker can only be created on a
   **closed-ended Vault** (`VaultKind=1`). Its immutable `SubscriptionDate` and `RedemptionDate` map to our
   **funding deadline** and **maturity**:
   - Deposits are allowed only during Subscription.
   - `LoanSet` is allowed only after `SubscriptionDate`, and the loan must mature at least 60s before `RedemptionDate`.
   - `VaultWithdraw` is **blocked** between the two dates.
3. **[Changed]** `EscrowFinish` can be submitted by **anyone** who has the fulfillment. No signer list gates it.
   So **the person who holds the preimage is the release key**.

## Accounts

| Account | Purpose | Key control |
|---|---|---|
| `issuer` | Issues mock `RLUSD` IOU (hex currency `524C555344000000000000000000000000000000`). Sets `asfAllowTrustLineLocking` (flag 17) so IOU escrow works, and `asfDefaultRipple` **before** any trust lines exist. **No TransferRate.** **[Verified]** | platform-held (demo) |
| `platform` | Vault owner **=** LoanBroker owner (the protocol requires the same account), first-loss cover provider, Credential issuer, PermissionedDomain owner. Countersigns LoanSet as `Account`. **[Verified]** | platform |
| `project:<id>` (SPV) | Borrower of the loan. Creates the milestone escrows and repays the loan. **Master key disabled**, SignerList only. **[Verified: a multisig borrower is allowed]** | SignerList (below) |
| `builder` | Receives milestone payouts and repays. **Must hold an RLUSD trust line before the first release** (`tecNO_LINE`). **[Verified]** | builder |
| `investor[1..n]` | Vault depositors. Hold `KYC_INVESTOR` (accepted) for the private vault | investor |
| `inspector[1..2]` | **Release-key holder:** generates the preimage per milestone escrow. Signs attestations. Signer on the SPV | inspector (Ledger device = stretch) |
| `aiAgent` | **[Changed]** Signs on-chain *attestation* txs (verdict hash in a memo). **Not** an SPV signer | verifier service |
| `trustee` | **[Changed]** Independent 4th SPV signer (investor representative). In the demo it's a server-held key, and we disclose that | trustee |

### SPV signer list **[Changed]** (old: inspectors w2 / AI w1 / platform w1 / quorum 3)

`SignerQuorum = 3`; `platform 1, builder 1, inspector 1, trustee 1`.
- The platform always needs **two** outside parties. With the old list the platform held the AI and platform keys,
  so **platform + any 1 inspector** could empty the SPV or `SignerListSet` to take it over.
- No single party can block the SPV, because the other three meet quorum.
- The SPV signer list governs `LoanSet` (countersign), `EscrowCreate`, `LoanPay` and `SignerListSet`. It does **not** govern release.
- **Collusion bound (say it in the pitch):** 3 of 4 colluding signers can move only the SPV's *liquid* RLUSD.
  The design keeps that near 0: escrows are created right after LoanSet, and refunds are LoanPay'd right after cancel.
  **Nobody can redirect a live escrow.**

## Money flow (happy path)

```
platform  --VaultCreate(closed-ended, private+DomainID, AssetsMaximum=principal,
                         SubscriptionDate=fundingDeadline, RedemptionDate=maturity+buffer)--> Vault   [Changed]
platform  --LoanBrokerSet(CoverRateMinimum=10000, CoverRateLiquidation=100000)--> LoanBroker(vault)  [Changed]
platform  --LoanBrokerCoverDeposit(10% of principal)--> first-loss cover                               [Changed]
investors --VaultDeposit(RLUSD) during Subscription--> Vault  (investors get share MPTs)              [Verified]
   ... SubscriptionDate passes (Investment phase) ...
platform(Account, single-sig) + SPV(Counterparty, CounterpartySignature.Signers multisig)
          --LoanSet(tfLoanOverpayment, PaymentTotal>=2, InterestRate>0, late fees 0)--> RLUSD principal -> SPV  [Changed]
SPV(multisig) --EscrowCreate x N IMMEDIATELY (milestone i: Amount_i, Destination=builder,
                Condition_i from inspector, CancelAfter_i < loan maturity)                            [Changed]
      ... builder submits evidence; AI verdict + attestation tx; inspector attestation tx ...
inspector (or core, given the fulfillment at approval) --EscrowFinish(Condition_i, Fulfillment_i)--> RLUSD -> builder
builder --Payment--> SPV ; SPV --LoanPay (multisig)--> Vault  (AssetsAvailable up)
```

**[Changed]** Share value (`AssetsTotal/shares`) goes up at **LoanSet**, because the protocol books the contracted
interest at origination. Repayments turn that value into withdrawable liquidity (`AssetsAvailable`).
Investors redeem from `RedemptionDate` on.

Optional stretch: wrap `LoanSet + EscrowCreate×N` (N ≤ 7) in an `ALLORNOTHING` **Batch** so the SPV never
holds liquid principal at a ledger boundary.

## Stall path **[Changed]**

`CancelAfter_i` passes → **anyone** submits `EscrowCancel` → RLUSD goes back to the **SPV** (not to investors)
→ the SPV sends a multisig `LoanPay` with `tfLoanOverpayment`. The payment must be on time and at least one periodic
payment; the excess goes to principal → vault `AssetsAvailable` goes up → investors `VaultWithdraw` **from `RedemptionDate`**.
Money already released and not repaid is credit loss. The platform can `LoanManage(tfLoanDefault)` after due+grace;
first-loss cover absorbs part of it, and the vault writes down the rest.

None of this is automatic: core runs a **keeper** that submits the cancel and the LoanPay.

## Escrow gating — the subtle part **[Changed: Shamir dropped]**

`EscrowFinish` can be submitted by **anyone** once its conditions are met. So gating comes from a
crypto-condition (`PREIMAGE-SHA-256`), and **whoever holds the preimage releases**. Plan:

1. Inspectors are assigned **before loan close**. The condition is immutable once the escrow exists.
2. The inspector's client (browser WebCrypto; later Ledger-backed) generates a **fresh 32-byte random preimage `P_i`
   per milestone escrow**. It keeps `P_i` (with an encrypted backup export) and sends **only**
   `Condition_i = A0258020‖SHA256(P_i)‖810120` to core. Core **rejects duplicate conditions**: the preimage becomes public
   on finish, so a reused condition would let anyone release the other escrow.
3. The SPV multisig puts `Condition_i` into `EscrowCreate`. The inspector UI then reads the escrow back from the ledger and
   shows "condition matches your key". This catches a colluding quorum swapping in a condition it knows.
4. Approvals are **on-chain attestations**: memo'd txs signed by `aiAgent` (verdict hash), the inspector, and the platform.
   This is the audit trail of *who* approved *what* and *when*.
5. On approval, the inspector client reveals `Fulfillment_i = A0228020‖P_i`. It either submits `EscrowFinish` itself, or passes it
   to core, which checks it against the stored condition and submits immediately. The platform never holds a
   fulfillment before approval.
   - Policy: the inspector client won't reveal without an AI `pass` unless the inspector posts an on-chain
     override attestation with a reason.
   - 2-inspector milestones: `P = a XOR b`. A's client generates both, sends `b` to B encrypted, then deletes it.
     This relies on trusting A's client at creation time, and we disclose that.

Honest trust statement: **the inspector is the release key.** AI and platform approvals are recorded on-chain but are not
enforced by the ledger. Enforced multi-party release needs Smart Escrows (XLS-100), which is **not on devnet**.
That's our "what's next" slide.

Value of escrow even so: once created, milestone money can **only** go to that builder or back to
the SPV. Nobody can redirect it, including signers, the platform and the inspector. **[Verified]**

## Stretch on-chain features (cheap wins for judges)

- **Credentials**: `VERIFIED_BUILDER`, `KYC_INVESTOR` issued by the platform. The subject must `CredentialAccept`, otherwise
  the credential isn't valid. **[Verified]**
- **Permissioned Domain + private Vault**: `tfVaultPrivate` + `DomainID`. Only accepted `KYC_INVESTOR` holders can
  deposit. Withdraw ignores the domain, so investors can't be locked out. Add `tfVaultShareNonTransferable`. **[Verified]**
- **Ledger device**: the inspector signs their attestation, and holds/derives the preimage, on a Ledger (Ledger bounty: "human approval for high-risk actions").
- **Batch**: atomic `LoanSet + EscrowCreate×N`. **[Verified: enabled; multisig BatchSigners allowed; ≤8 inner txs]**

## Software components

```
apps/web            Next.js (App Router) UI + route handlers. Investor / Builder / Inspector / Admin views.
packages/shared     Domain types, zod schemas, milestone templates, state machine. THE CONTRACT. Change via PR only.
packages/xrpl       All ledger ops (typed functions) + devnet scripts (bootstrap, full demo flow).
packages/verifier   AI verification (Claude API, vision) with policy-per-project-type; mock mode without API key.
packages/core       Orchestrator: project/milestone workflow, approvals, persistence (JSON store), keeper, calls xrpl + verifier.
packages/ledger-signer  Inspector signing (software key now, Ledger/Speculos stretch).
```

Dependency direction: `web → core → (xrpl, verifier) → shared`. Nothing imports `web`. HTTP + port contract: `docs/05-api.md`.

## Milestone state machine (in `packages/shared`)

```
draft -> terms_locked -> funding -> funded -> escrowed
escrowed -> evidence_submitted -> ai_reviewed -> inspected -> released
                                      |              |
                                      v              v
                                   rejected <--- rejected   (builder can resubmit -> evidence_submitted)
escrowed/evidence_* -> expired (CancelAfter passed) -> refunded (EscrowCancel ok) [-> repaid via LoanPay, project-level]
```

**[Changed]** Project-level additions: `funding` lasts until `SubscriptionDate`. `funded → escrowed` can only happen after
`SubscriptionDate` (LoanSet `tecTOO_SOON` before that). Investor withdrawals open at `RedemptionDate`.

## AI verifier contract

Input: milestone template (required evidence), evidence bundle (photos w/ EXIF, invoices, docs), project
context (site geo, budget line, builder risk tier). Output: `Verdict` — `decision: pass | fail | needs_human`,
`confidence`, per-check results with reasons and evidence refs. Policy varies by project type and risk tier
(e.g. high-value milestone → require 2 inspectors, stricter thresholds). See `packages/shared/src/verdict.ts`.
**[Changed]** The verdict hash is attested on-chain by `aiAgent`. It is a *signal to the inspector*, not a release key.
