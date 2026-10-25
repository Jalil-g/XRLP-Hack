# 00 — Drawproof: technical architecture summary (one page, read first)

> v2, 2026-10-24. Details: `02-product.md` (flow), `03-architecture.md` (ledger design), `05-api.md` (contract), `06-tickets.md` (work),
> `decisions.md` (why). Metaphor: **a GitHub release pipeline for construction draws.**

## What it is
A construction-lending marketplace on the XRP Ledger. Builders pay to have a project verified. KYC'd investors fund verified projects
through a native XRPL Vault. The loan goes to a project account no single party controls, which locks each milestone's RLUSD in an
escrow that can only pay the builder or go back. Each milestone has a **test suite**: a licensed inspector's signed site audit plus the
AI's checks over the evidence. All required checks pass → the escrow releases in seconds. Any fails → locked, and the failing check is public.

## The four guarantees, and who enforces each
| Guarantee | Enforced by |
|---|---|
| A live escrow can only pay **this builder** or return to the project account after expiry. Nobody can redirect it, us included. | **Ledger** (Token Escrow: destination fixed at creation, `CancelAfter`) |
| The project account needs **3 of 4** signers (platform, builder, inspector, trustee) to do anything; it holds ≈ 0 liquid funds by design. | **Ledger** (SignerList, master key disabled) |
| Only `KYC_INVESTOR` holders can deposit; only `VERIFIED_BUILDER` projects are listed; inspectors hold `VERIFIED_INSPECTOR`. | **Ledger** (Credentials + Permissioned Domain on a private vault) |
| Money is released **only after the milestone test suite is green**, with the inspector's signed audit as a required check, and every check result attested on-chain **before** the finish. | **Platform release service** (holds the escrow preimages; disclosed) + public attestations. On-chain enforcement of this = Smart Escrows (XLS-100), roadmap. |

## Money path (devnet, real transactions)
```
builder  --Payment 250 RLUSD (verification fee; scales with project size in production)--> platform
platform --CredentialCreate VERIFIED_BUILDER--> builder (accepts)                      [after AI project verification]
platform --VaultCreate (closed-ended, private, SubscriptionDate=funding deadline, RedemptionDate=maturity+buffer)
platform --LoanBrokerSet (cover rates) + LoanBrokerCoverDeposit (10% first-loss)
investor --VaultDeposit RLUSD--> Vault (share tokens)                                  [during Subscription]
platform + SPV(3-of-4) --LoanSet--> full principal -> project account (SPV)             [after SubscriptionDate]
SPV(3-of-4) --EscrowCreate × N--> one escrow per milestone, Destination=builder, Condition_i, CancelAfter_i
   per milestone: builder evidence -> inspector audit (signed, attested) -> AI runs suite (verdict attested)
releaseService --EscrowFinish(Fulfillment_i)--> RLUSD -> builder                        [only if suite == pass]
builder --Payment--> SPV --LoanPay--> Vault ; investors VaultWithdraw from RedemptionDate
stall:  CancelAfter passes -> EscrowCancel -> SPV -> LoanPay -> Vault
```
XRPL primitives used: Single Asset Vault (XLS-65, closed-ended), Lending Protocol (XLS-66: LoanBroker, cover, LoanSet, LoanPay, LoanManage),
Token Escrow (XLS-85) with PREIMAGE-SHA-256 conditions, native multisig, Credentials (XLS-70), Permissioned Domains (XLS-80), memo
attestations, RLUSD (mock IOU on devnet). **Devnet only**: Vault + Lending are not on testnet/mainnet yet (vote opened Oct 2026).

## Accounts in the demo
`issuer` (mock RLUSD) · `platform` (vault + broker owner, credential issuer, fee receiver) · `releaseService` (preimages, finish, keeper) ·
`project:<id>` SPV (3-of-4 multisig, master disabled) · `builder` · `investor1..3` · `inspector1..3` (panel) · `aiAgent` (verdict attestations) · `trustee`.
Three are "human" wallets in the story (investor, builder, platform/pool); the rest are script-generated and faucet-funded in seconds.
**"Pool" = the Vault ledger object owned by `platform` + the per-project SPV**, not a plain wallet: that is what makes the pooled money non-redirectable.

## The milestone test suite (what "verification" means)
Deterministic: `required_evidence_present` · `gps_within_site` · `photo_fresh` · `no_duplicate_photo` (pHash across all projects) ·
`invoice_matches_budget` (vs Schedule of Values line) · `inspector_audit_present` (signed by the AI-assigned inspector, attested on-chain) · `audit_checklist_complete`.
AI judgement (Claude): `stage_visually_consistent` · `audit_matches_evidence` · `document_consistency`.
Policy per risk tier/amount: min confidence, two audits for large milestones. Outcome `pass` → release · `fail` → locked, resubmit/re-audit ·
`needs_human` → platform operator decides with a signed reason. Mock mode is deterministic for the demo fixtures.

## Project verification (AI-first, inspectors when necessary)
Paid per project (250 RLUSD in the demo; scales with project size). The AI checks **identity** (licence, insurance, entity; mock registries),
**feasibility** (Schedule of Values sums and line amounts vs regional ranges, permits, site), **capability** (track record, load, prior
milestone pass rate → risk tier). `needs_human` → an inspector is auto-assigned for a pre-construction visit. Pass → credential + listing.
Milestones come from the **Schedule of Values** (AIA G702/G703), so any building size works; residential templates are pre-filled SoVs.

## Software
```
apps/web (:3000)        marketplace · project detail with the checks panel · invest · portfolio · builder onboarding · SoV form · /demo
apps/inspector (:3001)  queue · audit form (checklist per SoV line + photos) · signed submission · audit history
packages/core (:4000)   HTTP routes 1–23 · workflows · release service (preimages, evaluateRelease, pre-reveal safety) · keeper · JSON store
packages/xrpl           every ledger op + bootstrap/prestage/demo scripts · LedgerPort adapter
packages/verifier       verifyProject · verifyMilestone (suite) · assignInspector · mock + live (Claude)
packages/shared         THE CONTRACT: types, SoV, states, ports (PR-only)
packages/attest-signer  software-key signing of inspector audit attestations (XRPL-08 Payment + `xrlp/attest/v1` memo)
web, inspector →HTTP→ core → (xrpl, verifier) → shared
```

## What we say on stage, and what we don't
Say: the ledger fixes *where* money can go; the suite plus on-chain attestations make *when* auditable; the inspector is a required check,
not a formality; the AI never redirects anything. Don't say: "trustless AI", "ledger-enforced release", "mainnet-ready", "automatic refunds to investors".
