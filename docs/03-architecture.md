# 03 — Technical Architecture

> Markers: **[Verified]** = checked against the spec or devnet, **[Changed]** = design changed after review.
> Evidence and citations are in `docs/xrpl-protocol-notes.md`. Direction change 2026-10-24 (Jalil): **release = milestone test
> suite run by the platform's AI; inspectors audit and sign, they do not hold a release key.** Marked **[Direction]**.

Network: **XRPL Devnet** (`wss://s.devnet.rippletest.net:51233`). Verified 2026-10-24: `SingleAssetVault`,
`LendingProtocol`, **`LendingProtocolV1_1`**, `TokenEscrow`, `Credentials`, `PermissionedDomains`, `MultiSignReserve`,
`ExpandedSignerList`, `BatchV1_1` are all **enabled on devnet** (rippled 3.4.1; reserves 1 / 0.2 XRP; base fee 1 drop;
faucet 100 XRP). Vault + LendingProtocol are **NOT** enabled on testnet. **[Verified]**

Library: `xrpl` (xrpl.js) **5.3.0**: typed `VaultCreate/Deposit/Withdraw` (incl. `VaultKind`, `SubscriptionDate`, `RedemptionDate`),
`LoanBrokerSet`, `LoanBrokerCoverDeposit`, `LoanSet`, `LoanPay`, `LoanManage`, `EscrowCreate/Finish/Cancel`, `SignerListSet`,
`Batch`, `Credential*`, `PermissionedDomainSet`, plus `signLoanSetByCounterparty` / `combineLoanSetCounterpartySigners`. **[Verified in source]**

## Key protocol facts that shaped the design

1. XLS-66 `LoanSet` sends the **entire principal to the borrower at once**. No draws. So staged release comes from **escrow**,
   and the borrower is a **project account** (SPV), not the builder. **[Verified]**
2. Under `LendingProtocolV1_1` (devnet) a LoanBroker needs a **closed-ended Vault** (`VaultKind=1`): `SubscriptionDate` =
   funding deadline, `RedemptionDate` = maturity + buffer. Deposits only during Subscription; `LoanSet` only after it; withdrawals
   blocked between the dates. **[Verified]**
3. `EscrowFinish` can be submitted by **anyone** with the fulfillment. No signer list gates release. **Whoever holds the preimage
   is the release key.** **[Verified]**
4. **[Direction]** We *choose* the platform's **release service** as the preimage holder, gated by the milestone test suite.
   The ledger guarantees **where** money can go (builder or back to the SPV); the test suite plus on-chain attestations make
   **when** it moves auditable. We say this out loud (slide 6).

## Accounts

| Account | Purpose | Key control |
|---|---|---|
| `issuer` | Mock `RLUSD` IOU (hex `524C555344000000000000000000000000000000`). `asfDefaultRipple` then `asfAllowTrustLineLocking` (flag 17), **before** any trust line. No TransferRate. **[Verified]** | platform (demo) |
| `platform` | Vault owner **=** LoanBroker owner (protocol requirement), first-loss cover provider, Credential issuer (`VERIFIED_BUILDER`, `VERIFIED_INSPECTOR`, `KYC_INVESTOR`), PermissionedDomain owner, receives **project verification fees**, countersigns `LoanSet` as `Account` | platform |
| `releaseService` **[Direction]** | Holds one random 32-byte preimage per milestone escrow. Submits `EscrowFinish` only when `evaluateRelease()` passes. Submits `EscrowCancel` after expiry (keeper). Separate key from `platform` so its actions are distinguishable on the explorer | platform (disclosed) |
| `project:<id>` (SPV) | Loan borrower. Creates milestone escrows, repays the loan. **Master key disabled**, SignerList only | SignerList (below) |
| `builder` | Pays verification fee; receives milestone payouts; repays. **RLUSD trust line before first release** (`tecNO_LINE`) | builder |
| `investor[1..n]` | Vault depositors with accepted `KYC_INVESTOR` | investor |
| `inspector[1..n]` | Panel of licensed inspectors with `VERIFIED_INSPECTOR`. **AI-assigned** per project at lock-terms. Signs **audit attestations**. Signer on the SPV | inspector |
| `aiAgent` | Signs **verdict attestations** (verdict hash + per-check results digest). Not an SPV signer | verifier service |
| `trustee` | Independent 4th SPV signer (investor representative). Server-held in the demo, disclosed | trustee |

### SPV signer list

`SignerQuorum = 3`; `platform 1, builder 1, inspector 1, trustee 1`. The platform always needs two outside parties; no single
party can block (the other three meet quorum). Governs `LoanSet` countersign, `EscrowCreate`, `LoanPay`, `SignerListSet`.
**Does not govern release.** Collusion bound: 3 of 4 can move only the SPV's *liquid* RLUSD, kept near 0 by creating escrows
right after `LoanSet` and `LoanPay`-ing refunds right after cancel. **Nobody can redirect a live escrow.** **[Verified]**

## Money flow (happy path)

```
builder   --Payment(fee RLUSD)--> platform                      project verification fee   [Direction]
platform  --CredentialCreate(VERIFIED_BUILDER)--> builder accepts                           (first verified project)
platform  --VaultCreate(closed-ended, private+DomainID, AssetsMaximum=principal,
                         SubscriptionDate=fundingDeadline, RedemptionDate=maturity+buffer)--> Vault
platform  --LoanBrokerSet(CoverRateMinimum=10000, CoverRateLiquidation=100000)--> LoanBroker(vault)
platform  --LoanBrokerCoverDeposit(10% of principal)--> first-loss cover
investors --VaultDeposit(RLUSD) during Subscription--> Vault  (share MPTs)
platform(Account) + SPV(Counterparty multisig) --LoanSet(tfLoanOverpayment, PaymentTotal>=2, InterestRate>0)--> RLUSD -> SPV
SPV(multisig) --EscrowCreate x N immediately (Amount_i, Destination=builder, Condition_i, CancelAfter_i < maturity)
      per milestone: builder evidence -> inspector audit attestation -> aiAgent verdict attestation
releaseService --EscrowFinish(Condition_i, Fulfillment_i)--> RLUSD -> builder      (only if evaluateRelease() == pass)
builder --Payment--> SPV ; SPV --LoanPay(multisig)--> Vault  (AssetsAvailable up)
```

Share value (`AssetsTotal/shares`) rises as **interest is repaid** (devnet-verified 2026-10-24, XRPL-04/09: `AssetsTotal` 30000 after LoanSet, 30000.0257 after LoanPay); it is 1.00 at close. Repayments also restore liquidity.
Investors redeem from `RedemptionDate`.

## Stall path

`CancelAfter_i` passes → `releaseService` (keeper; anyone could) submits `EscrowCancel` → RLUSD back to the **SPV** → SPV multisig
`LoanPay` with `tfLoanOverpayment` (on time, ≥ one periodic payment) → vault `AssetsAvailable` up → investors `VaultWithdraw`
from `RedemptionDate`. Released-but-unrepaid money is credit loss: `LoanManage(tfLoanDefault)` after due+grace, first-loss cover
absorbs `DefaultCovered`, vault writes down the rest. None of this is automatic; the keeper runs it, idempotently per step.

## Release = the milestone test suite **[Direction]**

Think GitHub checks on a release PR. Each milestone (one SoV line or group) carries a **check list** fixed at lock-terms:

| Check | Kind | Required? | Source |
|---|---|---|---|
| `required_evidence_present` | deterministic | yes | SoV line's evidence list |
| `gps_within_site` | deterministic (EXIF + geofence) | yes (needs_human if missing) | builder photos |
| `photo_fresh` | deterministic (EXIF time > escrow created) | yes | builder photos |
| `no_duplicate_photo` | deterministic (sha256 + pHash across **all** projects) | yes | builder photos |
| `invoice_matches_budget` | deterministic on extracted totals vs SoV line (±10% pass / ±25% warn) | yes | invoices |
| `inspector_audit_present` | deterministic: attestation tx exists, signed by the **assigned** inspector, references this milestone + evidence bundle hash | yes | inspector |
| `audit_matches_evidence` | AI judgement: inspector checklist vs builder claims vs photos | yes | inspector + builder |
| `stage_visually_consistent` | AI vision vs SoV line's visual criteria | yes | builder + inspector photos |
| `document_consistency` | AI: dates, parties, addresses agree | yes | documents |
| `lien_waiver_matches_invoices` | deterministic/AI | stretch | waivers |

Policy per risk tier / amount: `minConfidence` (0.7/0.8/0.9), **two inspector audits** for milestones ≥ `TWO_INSPECTOR_THRESHOLD`
or high-risk builders, stricter visual criteria for new builders.

`evaluateRelease(milestone)`:
1. every required check `pass` **and** verdict confidence ≥ `minConfidence` → **release** (`releaseService` finishes the escrow);
2. any required check `fail` → **locked**, state `failed`; builder resubmits (→ `evidence_submitted`) or inspector re-audits (→ `audited`);
3. otherwise → `needs_human`: a platform operator approves or rejects with a signed reason (on-chain attestation, role `platform`). Approval here is the **only** human override, and it is visible.

Before any finish, **pre-reveal safety**: escrow exists and is open, `CancelAfter` not passed, destination has an RLUSD trust
line, fee sized for the fulfillment, generous `LastLedgerSequence`. A failed finish with the right fulfillment would publish the
preimage while the escrow stays open. Never submit a finish expected to fail.

### Escrow gating and what the ledger enforces

- Condition `A0258020‖SHA256(P_i)‖810120`, fulfillment `A0228020‖P_i`, `P_i` = 32 CSPRNG bytes **unique per escrow** (reuse
  would let anyone finish the second escrow once the first fulfillment is public). Core rejects duplicate conditions.
- `P_i` lives in the release service's store (encrypted at rest; demo: `DATA_DIR`, disclosed).
- **Honest trust statement (say it):** the ledger enforces *destination* (builder or SPV) and *expiry*. Release *timing* is the
  platform's published test suite with the inspector's signed audit as a mandatory input, and every check result is attested
  on-chain **before** the finish, so anyone can verify that the money moved only after the suite went green.
  Ledger-enforced multi-party release (the suite result as an on-chain rule) is Smart Escrows (XLS-100), not on devnet: roadmap.
- Worst case if the release service is compromised: an **early release to the correct builder**, never a redirection.

## Project verification (AI-first, inspectors when necessary) **[Direction]**

Input: builder documents (licence, insurance, entity), the SoV, site geo, prior platform history. Output `ProjectVerification`:
`identity`, `feasibility`, `capability` each with checks + reasons, overall `pass | fail | needs_human`, `riskTier`.
- `needs_human` on feasibility → an inspector is auto-assigned for a pre-construction site visit; their signed report re-enters the AI.
- `pass` → `VERIFIED_BUILDER` credential (first time), project **verified** and listed. Paid by the per-project fee (route 15).
Registries are mocks, labelled MOCK in the UI.

## Inspector assignment **[Direction]**

Fully automated: the AI scores the verified inspector panel by region, trade match to the SoV, availability, open load, and
prior agreement with the test suite (inspectors whose audits are often contradicted by the checks score down). Top match is
assigned at lock-terms (before `EscrowCreate`, so they can be an SPV signer). Rotation is across projects.
Roadmap: robots/sensors file audits through the same `InspectorAudit` interface.

## Stretch on-chain features

Credentials for all three roles, Permissioned Domain + private vault (`tfVaultPrivate`, `tfVaultShareNonTransferable`), Batch
atomic close (`LoanSet + EscrowCreate×N`), "Ledger says no" demo tx (platform submits a wrong-fulfillment finish →
`tecCRYPTOCONDITION_ERROR`, recorded on-ledger).

## Software components

```
apps/web            Next.js: marketplace (verified projects), project detail = demo screen (milestone checks panel, money map,
                    timeline), invest, portfolio, builder onboarding (fee → verification), create project from SoV, /demo control room.
apps/inspector      Next.js (:3001): inspector queue (assigned audits), audit form (checklist per SoV line + photos + notes),
                    signed submission, audit history with the checks it fed.
packages/shared     Domain types, zod schemas, SoV + templates, state machine, ports. THE CONTRACT. PR only.
packages/xrpl       All ledger ops + devnet scripts (bootstrap, demo, prestage, compliance). LedgerPort adapter.
packages/verifier   Project verification + milestone test suite (deterministic checks + Claude), inspector matching, mock mode.
packages/core       Orchestrator + HTTP server: workflows, release service (preimages, evaluateRelease, pre-reveal safety),
                    keeper, JSON store, adapter factory.
packages/ledger-signer  Attestation signing (software key). Hardware-wallet backend parked.
```

Dependency direction: `web, inspector →(HTTP)→ core → (xrpl, verifier) → shared`. HTTP + port contract: `docs/05-api.md`.

## State machines (in `packages/shared`)

```
Project:   draft -> verifying -> verified -> terms_locked -> funding -> funded -> escrowed -> repaying -> completed
                       |-> rejected                                              '-> stalled (any milestone refunded; others continue)
Milestone: pending -> escrowed -> evidence_submitted -> audited -> verified -> released
                                       ^                  |          |
                                       '---- failed <-----'----------'   (resubmit evidence or re-audit)
                                                          needs_human -> verified | failed   (platform operator, signed reason)
           escrowed/evidence_submitted/audited/failed -> expired (CancelAfter passed) -> refunded
```

`funded → escrowed` only after `SubscriptionDate` (`tecTOO_SOON` before). Withdrawals only from `RedemptionDate`.

## Verifier contract

`verifyProject(input) → ProjectVerification` · `verifyMilestone(input) → Verdict` (per-check `CheckResult`s, `decision`,
`confidence`, `policy`) · `assignInspector(project, panel) → InspectorAssignment` · `verdictHash(v)` canonical sha256.
Mock mode is deterministic for the demo fixtures: Maple St foundation → `pass`, framing with a reused photo → `fail`
(`no_duplicate_photo`), a milestone with a missing audit → `fail` (`inspector_audit_present`).
