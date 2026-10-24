# 03 — Technical Architecture

Network: **XRPL Devnet** (`wss://s.devnet.rippletest.net:51233`). Verified 2026-10-24: `SingleAssetVault`,
`LendingProtocol`, `TokenEscrow`, `Credentials`, `PermissionedDomains`, `MultiSignReserve`,
`ExpandedSignerList` all **enabled on devnet**. Vault + LendingProtocol are **NOT** enabled on testnet.

Library: `xrpl` (xrpl.js) **5.3.0** — has typed `VaultCreate/Deposit/Withdraw`, `LoanBrokerSet`,
`LoanSet`, `LoanPay`, `LoanManage`, `EscrowCreate/Finish/Cancel`, `SignerListSet`, `Credential*`,
`PermissionedDomainSet`.

## Key protocol fact that shaped the design

XLS-66 `LoanSet` disburses the **entire principal to the borrower at once** — no draws/tranches.
So staged release comes from **escrow**, and the borrower is a **project account** (SPV), not the builder.

## Accounts

| Account | Purpose | Key control |
|---|---|---|
| `issuer` | Issues mock `RLUSD` IOU (hex currency `524C555344000000000000000000000000000000`). Sets `asfAllowTrustLineLocking` so IOU escrow works, and `asfDefaultRipple`. | platform-held (demo) |
| `platform` | Vault owner, LoanBroker owner, Credential issuer, PermissionedDomain owner | platform |
| `project:<id>` (SPV) | Borrower of the loan; creates milestone escrows; repays loan | **master key disabled**; SignerList only |
| `builder` | Receives milestone payouts; repays | builder |
| `investor[1..n]` | Vault depositors | investor |
| `inspector[1..2]` | Signers on SPV | inspector (Ledger device = stretch) |
| `aiAgent` | Signer on SPV | verifier service |

### SPV signer list (my call — change in `docs/decisions.md` if you disagree)

`SignerQuorum = 3`; inspector A weight 2, inspector B weight 2, aiAgent weight 1, platform weight 1.
→ **Every action needs an inspector**, plus either a second inspector, the AI, or the platform.
→ No single party (including the platform) can move SPV funds.

## Money flow (happy path)

```
investors --VaultDeposit(RLUSD)--> Vault  (investors get share MPTs)
platform  --LoanBrokerSet--> LoanBroker(vault)
SPV+platform --LoanSet (countersigned, SPV multisig)--> RLUSD principal -> SPV
SPV --EscrowCreate x N (milestone i: Amount_i, Destination=builder, Condition_i, CancelAfter_i)
      ... builder submits evidence; AI verdict; inspector signs ...
anyone --EscrowFinish(Fulfillment_i)--> RLUSD -> builder
builder --Payment--> SPV ; SPV --LoanPay (multisig)--> Vault  (share value up)
```

## Stall path

`CancelAfter_i` passes → anyone submits `EscrowCancel` → RLUSD back to SPV → SPV `LoanPay` (multisig) →
vault liquidity → investors `VaultWithdraw`.

## Escrow gating — the subtle part (OPEN, xrpl owner to validate)

`EscrowFinish` can be submitted by **anyone** once its conditions are met. So gating must come from a
crypto-condition (`PREIMAGE-SHA-256`). Plan:

1. At escrow creation, the release service generates preimage `P_i` per milestone, puts `Condition_i` on-chain.
2. `P_i` is split with **2-of-3 Shamir** into shares for inspector / aiAgent / platform (mirrors the signer
   list). No single party can release.
3. On approval, the required parties submit shares → service reconstructs `P_i` → `EscrowFinish`.
4. Approvals themselves are also recorded on-chain (memo'd attestation tx signed by each approver) so the
   audit trail shows *who* approved.

Fallback if Shamir is too much: release service holds `P_i` and only reveals after collecting signed
attestations (document this honestly as a trust assumption).

Value of escrow even with this: once created, milestone money can **only** go to that builder or back to
the SPV. Signers can't redirect it.

## Stretch on-chain features (cheap wins for judges)

- **Credentials**: `VERIFIED_BUILDER`, `KYC_INVESTOR` issued by platform.
- **Permissioned Domain + private Vault**: only `KYC_INVESTOR` holders can deposit → regulatory answer.
- **Ledger device**: inspector signs their attestation/share on a Ledger (Ledger bounty: "human approval for high-risk actions").

## Software components

```
apps/web            Next.js (App Router) UI + route handlers. Investor / Builder / Inspector / Admin views.
packages/shared     Domain types, zod schemas, milestone templates, state machine. THE CONTRACT. Change via PR only.
packages/xrpl       All ledger ops (typed functions) + devnet scripts (bootstrap, full demo flow).
packages/verifier   AI verification (Claude API, vision) with policy-per-project-type; mock mode without API key.
packages/core       Orchestrator: project/milestone workflow, approvals, persistence (JSON store), calls xrpl + verifier.
```

Dependency direction: `web → core → (xrpl, verifier) → shared`. Nothing imports `web`.

## Milestone state machine (in `packages/shared`)

```
draft -> terms_locked -> funding -> funded -> escrowed
escrowed -> evidence_submitted -> ai_reviewed -> inspected -> released
                                      |              |
                                      v              v
                                   rejected <--- rejected   (builder can resubmit -> evidence_submitted)
escrowed/evidence_* -> expired (CancelAfter passed) -> refunded
```

## AI verifier contract

Input: milestone template (required evidence), evidence bundle (photos w/ EXIF, invoices, docs), project
context (site geo, budget line, builder risk tier). Output: `Verdict` — `decision: pass | fail | needs_human`,
`confidence`, per-check results with reasons and evidence refs. Policy varies by project type and risk tier
(e.g. high-value milestone → require 2 inspectors, stricter thresholds). See `packages/shared/src/verdict.ts`.
