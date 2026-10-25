# Drawproof

> **Adopted pitch (2026-10-25):** [six-slide storyline](../08-pitch-storyline.md), [100-second recorded demo](../04-demo-script.md), [deck style guide](../ideas/pitch-3min-style-guide.md), and [Claude PowerPoint prompts](../ideas/pitch-3min-claude-prompts.md). These supersede older presentation timing and slide numbers below.

Presentation deliverables: exactly six slides and a 100-second primary demo video. The deck and MP4 have not yet been produced by the documentation update; prompts and specifications are ready. Add real artifact links below after production.

**Construction money that moves only when the building does.**
XRPL Lending & Borrowing track · AI & Fintech XRPL Hackathon NYC, Oct 24–25 2026 · devnet prototype, not an offer to invest.

| | |
|---|---|
| Code | https://github.com/Jalil-g/XRLP-Hack |
| Primary demo video (100 s) | TODO(PITCH-08) |
| Pitch deck | TODO(PITCH-06) |
| Every XRPL primitive we use: code + devnet proof | [xrpl-primitives.md](xrpl-primitives.md) |
| What we don't claim | [what-we-dont-claim.md](what-we-dont-claim.md) |
| Full end-to-end devnet run (2026-10-25) | [proof-devnet-2026-10-25-v2.md](../proof-devnet-2026-10-25-v2.md) |

## Pitch

Drawproof is a construction-lending marketplace on the XRP Ledger, built like a GitHub release pipeline for construction draws. A builder
pays to have a project verified (AI-first, with a licensed inspector when the AI needs eyes on site). KYC'd investors pool RLUSD into that
project's native XRPL Vault. The Lending Protocol lends the principal to a project account that no single party controls, and that account
immediately locks each milestone's money in its own escrow, which can only ever pay **this builder** or go back. Every milestone has a
**test suite**: a licensed inspector's signed site audit plus the AI's checks over the builder's evidence. All required checks green → the
escrow releases in seconds. One red → the money stays locked, and everyone can see which check failed. The recording must disclose its actual ledger and verifier modes; real devnet transactions have explorer links, while fixtures and mock judgments remain labeled.

## Problem

- **Investor money leaves their control before anything is built.** In 2023 ~$63M from ~800 accredited investors on CrowdStreet was wired
  to an account the sponsor controlled instead of escrow, and most of it was diverted ([Bisnow](https://www.bisnow.com/news/national/office/doj-sec-investigating-nightingale-after-45m-of-investor-cash-allegedly-diverted-to-ceos-accounts-120196)).
- **Draws are slow and run on one party's say-so.** 5–14 business days from draw request to funding
  ([Bisnow Studio B](https://www.bisnow.com/studio-b/national/construction-development/construction-project-operations-capital-built-technologies), vendor-reported).
- **Small builders are starved of credit.** Q2 2026 was the 18th straight quarter of tightening construction credit
  ([NAHB](https://eyeonhousing.org/2026/08/cost-of-credit-for-builders-up-since-the-end-of-2025/)); private lenders fill the gap at
  12–15% plus points ([Cor Advisors](https://www.coradvisors.net/2026/08/hard-money-loans-vs-bridge-loans-2026.html), lender-published).
- **Draw fraud is a known pattern.** FinCEN's CRE-fraud study lists falsified draw requests and invoices and "receipts dated prior to
  the loan" ([FinCEN](https://www.fincen.gov/system/files/shared/Commercial%20Real%20Estate%20Financing%20Fraud%20FINAL%20508.pdf)).
  Putting *loans* on-chain didn't fix it (Goldfinch): disbursement itself has to be controlled.

Sources and caveats: [`docs/01-problem.md`](../01-problem.md).

## What we built

```
builder   --Payment 250 RLUSD (verification fee)--> platform   → AI verifies identity, feasibility, capability → VERIFIED_BUILDER credential
investors --VaultDeposit (KYC_INVESTOR only)--> closed-ended Vault (XLS-65), one per project
Vault     --LoanSet (XLS-66), countersigned 3 of 4--> project account (SPV: multisig, master key disabled)
SPV       --one Batch (XLS-56) of EscrowCreate × N (XLS-85)--> one escrow per milestone: Destination = builder, PREIMAGE-SHA-256 condition, CancelAfter
          per milestone: builder evidence → inspector's signed audit (on-chain) → AI runs the suite (verdict on-chain)
release service --EscrowFinish--> RLUSD to the builder, only when the suite is green
stall:    CancelAfter passes → EscrowCancel → SPV → LoanPay → Vault; investors redeem from RedemptionDate
default:  released money not repaid → LoanManage default → first-loss cover pays the vault 10% of the debt, investors absorb the rest
```

- **`packages/xrpl`**: every ledger operation, devnet scripts and proofs, the `LedgerPort` adapter core uses.
- **`packages/verifier`**: project verification (identity, feasibility, capability → risk tier) and the milestone test suite. Deterministic
  checks: `required_evidence_present`, `gps_within_site`, `photo_fresh`, `no_duplicate_photo` (pHash across all projects),
  `invoice_matches_budget` (vs the Schedule of Values line), `inspector_audit_present` (signed by the AI-assigned inspector, on-chain),
  `audit_checklist_complete`. Judgement checks with Claude: `stage_visually_consistent`, `audit_matches_evidence`, `document_consistency`.
  Outcome `pass` → release, `fail` → locked, `needs_human` → a platform operator decides with a signed, on-chain reason.
- **`packages/core`**: orchestrator, HTTP API, the release service (one random preimage per escrow, encrypted at rest; pre-reveal safety
  checks before any finish), keeper for expiries.
- **`apps/web`**: marketplace of verified projects, project page with a CI-style checks panel and money map, invest, portfolio, builder
  onboarding, `/demo` control room. **`apps/inspector`**: assigned audits, checklist per Schedule of Values line, geotagged photos, audit
  signed in the browser (`packages/attest-signer`). **`packages/shared`**: the contract (types, states, ports).

Milestones come from the project's Schedule of Values (AIA G702/G703), so the model fits any building size. The demo is a duplex on Maple St.

## The four guarantees, and who enforces each

| Guarantee | Enforced by |
|---|---|
| A live milestone escrow can only pay **this builder**, or return to the project account after `CancelAfter`. Nobody can redirect it, us included. | **Ledger** (Token Escrow: destination fixed at creation, mandatory `CancelAfter`) |
| The project account needs **3 of 4** signers (platform, builder, inspector, trustee) to do anything, and holds ≈ 0 liquid RLUSD by design. | **Ledger** (SignerList quorum 3, master key disabled) |
| Only `KYC_INVESTOR` holders can deposit; listed projects carry `VERIFIED_BUILDER`; inspectors hold `VERIFIED_INSPECTOR`. | **Ledger** (Credentials + Permissioned Domain on a private vault) |
| Money is released **only after the milestone's test suite is green**, with the inspector's signed audit as a required check, and every check result attested on-chain **before** the finish. | **Our release service** (holds the escrow preimages; disclosed) + public attestations. On-chain enforcement = Smart Escrows (XLS-100), roadmap |

**Honest trust statement.** The ledger enforces *where* the money can go (this builder, or back) and *when it expires*. *When it is
released* is decided by our published test suite, with a licensed inspector's signed audit as a mandatory input, and every result is
attested on-chain before the `EscrowFinish`, so anyone can check afterwards that the money moved only after the suite went green. If our
release service were compromised, the worst case is an early release to the correct builder, never a redirection. Making the suite itself
the on-chain release rule needs Smart Escrows (XLS-100), which aren't on devnet yet: that's our roadmap.

## See it on devnet in 60 seconds

| What happened | Transaction |
|---|---|
| The vault lends to the project account, countersigned by 3 of its 4 signers (master key disabled) | [LoanSet](https://devnet.xrpl.org/transactions/CB2FC8BC3E359DE2CB32DD37D81440B0DD2674E19123552F23884E89B9E0694E) |
| Milestone 1 locked in its own escrow, payable only to the builder | [EscrowCreate](https://devnet.xrpl.org/transactions/191E0B3E5E2A3B644F9F679B9087CA785AA218DFE26E886901E7BF217C975254) |
| Milestone 1 released: 9 000 RLUSD to the builder | [EscrowFinish](https://devnet.xrpl.org/transactions/AEBAE654EE00A0F1B88F19B44BAED9B02B4465311B70428B3B33DC2D2A787B75) |
| "Ledger says no": a finish with the wrong fulfillment | [`tecCRYPTOCONDITION_ERROR`](https://devnet.xrpl.org/transactions/61E13CB3CE9297886E7A46C784951B9D1E5BD75335C0D026A3FA47673C22A2B5) |
| An investor without KYC tries to deposit | [`tecNO_AUTH`](https://devnet.xrpl.org/transactions/6D17631BB609C7716C145A5F37EB4179D6E75730E9D2C7BA875E31F0505D45DE) |
| Stall: the expired escrow goes back to the project account, which repays the vault | [EscrowCancel](https://devnet.xrpl.org/transactions/3BD1B494EEAC9A897879434E7657C95C8F19C485053D825F44E5E59E9F0F5AF0) · [LoanPay](https://devnet.xrpl.org/transactions/686028E03383EC8AC3DE4CEF02B087822EA06D1EF34E6A7906E974C247EA4B25) |
| The inspector's audit, signed offline, attested on-chain | [audit attestation](https://devnet.xrpl.org/transactions/027F4FE6972AC8C2203E3C44E80E9FEA5E2D785B5AB81CD0CB70C7BE5D516CD3) |

All of them, with code pointers: [xrpl-primitives.md](xrpl-primitives.md).

## How to run

Node ≥ 22 (we use 24) and pnpm 10.

```bash
git clone https://github.com/Jalil-g/XRLP-Hack && cd XRLP-Hack
pnpm install
cp .env.example .env                    # devnet + mock defaults; .env is gitignored
pnpm -r typecheck && pnpm -r test
```

**Fake mode**: no keys, no network. Both apps label mock mode on screen. Fake-mode tx hashes are not real, even where they're printed as
explorer links.

```bash
pnpm --filter @xrlp/web dev             # :3000 marketplace, project page, /demo
pnpm --filter @xrlp/inspector dev       # :3001 inspector queue + audit form, signs in the browser
pnpm --filter @xrlp/core simulate       # the whole story on FakeLedger + FakeVerifier, prints the timeline
pnpm --filter @xrlp/verifier demo       # the test suite over the Maple St fixtures (VERIFIER_MODE=live calls Claude)
```

**Devnet**: real transactions, each logged with its explorer link. The scripts refuse mainnet. Wallets go to `.data/` (gitignored).

```bash
pnpm --filter @xrlp/xrpl bootstrap      # 12 faucet-funded roles, mock RLUSD, credentials; idempotent (2nd run: 0 tx)
pnpm --filter @xrlp/xrpl demo           # full money path, ~6 min: private vault, broker, cover, 3-of-4 LoanSet, escrows in one Batch, finish, cancel, refund
pnpm --filter @xrlp/xrpl prestage       # stage projects A ready / B stalled / C repaid for recording or an extended walkthrough (~13 min) → .data/prestage.json
pnpm --filter @xrlp/xrpl compliance     # 3 credential types, domain + private vault, tecNO_AUTH, fee, attestations
pnpm --filter @xrlp/xrpl spike:escrow   # tecCRYPTOCONDITION_ERROR, tecNO_LINE leak vs preflight refusal, tecNO_PERMISSION
pnpm --filter @xrlp/xrpl spike:loanset  # 3-of-4 countersigned LoanSet, tecNO_PERMISSION, tecTOO_SOON
pnpm --filter @xrlp/xrpl spike:broker   # cover rates, tecINSUFFICIENT_FUNDS, origination fee
pnpm --filter @xrlp/xrpl spike:batch    # XLS-56 Batch: atomic escrows; LoanSet as inner tx → temINVALID_INNER_BATCH
pnpm --filter @xrlp/xrpl spike:close-batch  # the close path's escrow Batch, a rolled-back Batch, and the exact resume
pnpm --filter @xrlp/xrpl spike:default  # LoanManage impair / default: tecTOO_SOON, first-loss cover pays 10% of the debt, tecKILLED
```

Last checked on devnet, 2026-10-25 ~03:35–03:50 UTC, on the code of `main` @ 53ffcf8: `demo` ran end to end with exit 0 (tx table in
`packages/xrpl/proof/xrpl-11-devnet-2026-10-25.md`, M5 run: LoanSet, then one Batch of 3 escrows), and `spike:escrow` passed all 4 cases
(finish to the builder, `tecCRYPTOCONDITION_ERROR`, `tecNO_LINE` leak, `tecNO_PERMISSION` after `CancelAfter`).

**Full UI on devnet**: TODO(T+32h) confirm against the `demo-v1` tag: `LEDGER_MODE=devnet pnpm --filter @xrlp/core serve` (:4000), then
both apps with `NEXT_PUBLIC_API_MODE=http`.

## Team

| Who | Lane | Code |
|---|---|---|
| Jalil ([Jalil-g](https://github.com/Jalil-g)) | XRPL ledger layer: vault, lending, escrow, multisig, credentials, attestations, devnet proofs | `packages/xrpl` |
| Elmir ([elmir132](https://github.com/elmir132)) | AI verifier: project verification and the milestone test suite | `packages/verifier` |
| Bri ([bri-yin](https://github.com/bri-yin)) | Investor and builder web app, `/demo` control room | `apps/web` |
| Roro ([RoroDev2023](https://github.com/RoroDev2023)) | Inspector app and signed audit submission | `apps/inspector`, `packages/attest-signer` |
| Sean ([seanpatrickmay](https://github.com/seanpatrickmay)) | Orchestrator, HTTP API, release service, shared contract | `packages/core`, `packages/shared` |

Built with TypeScript, xrpl.js 5.3.0, Next.js, Hono, and Claude through the Anthropic SDK.
