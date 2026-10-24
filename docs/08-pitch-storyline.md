# 08 — Pitch storyline (3:00), slide story, demo beats, script skeleton

> v2, 2026-10-24 (Jalil). Model: **a GitHub release pipeline for construction draws.** Companion: `docs/04-demo-script.md` (beats),
> `docs/07-pitch.md` (Q&A, business, why XRPL), `docs/ideas/design-review-2026-10-24.md` (flaws). Numbers stay sourced in `docs/01-problem.md`.

## 0. Ground rules

- Rubric unpublished; past XRPL Commons events: *Innovation · Execution · Impact · Pitch*. "Potential" (robots, Smart Escrows, SoV for any
  building size) gets its own slide.
- Sponsor stance: Lending & Borrowing track is the target; AWS only as a Bedrock provider swap if the booth confirms; no Quicknode unless
  devnet; no Mastercard AP4M; **no hardware wallet**. Details `docs/ideas/sponsor-bounties.md`.
- **One spine: "Who can move the money, and when?"** The ledger answers *where* (destination fixed). The test suite answers *when*, publicly.
- Storyline over features. If a feature doesn't appear in a beat below, it doesn't get built before T+24h.

## 1. Story arc

1. **Failure** — $63M wired to a sponsor before anything was built. Draws still move on email and PDFs, 5–14 days, on one party's say-so.
2. **Rule** — *Construction money should move only when the building does.*
3. **Mechanism** — Builders pay to be verified (identity, feasibility, capability). Investors fund a verified project's vault. The loan goes
   to a project account no single party controls, which locks each milestone in an escrow that can only pay the builder or go back.
   Each milestone has a **test suite**: a licensed inspector's signed audit plus the AI's checks over the evidence. All green → release.
4. **Proof** — Live: a verified project, a milestone passing its suite and paying in seconds, a fraud caught by one red check, the platform
   itself trying to release and the ledger refusing, a stalled milestone refunded.
5. **Honesty** — What the ledger enforces (destination, expiry) vs what the platform runs (the suite, attested on-chain before every release).
6. **Potential** — SoV means any building size; robots and sensors file audits through the same interface; Smart Escrows put the suite on-chain.
7. **Business** — Verification fee, origination, management fee, inspection; first-loss cover; accredited-only launch.

Framing: marketplace of **verified projects** for KYC'd investors (private vault + credential). Institutional lenders are the same rail
with one depositor; say that to Soil/Evernorth.

## 2. Slide story (8 slides)

| # | Slide | On screen | Purpose |
|---|---|---|---|
| 1 | **Title** | "Drawproof · Construction money that moves only when the building does." Team. "XRPL Lending & Borrowing · devnet prototype" | Hook |
| 2 | **The failure** | "$63M wired to the sponsor before a single deal closed." · "Draws: 5–14 business days, email + PDFs, one party's say-so." · "18 straight quarters of tighter builder credit." | Real need |
| 3 | **The money path (one picture)** | Builder pays **verification fee** → AI verifies → Investors → **Vault** (XLS-65) → **Loan** (XLS-66) → **Project account** (3-of-4) → **Escrow per milestone** (XLS-85) → Builder. Caption: "Once locked, nobody can redirect it. Not even us." | Innovation + why XRPL |
| 4 | **The release pipeline** | A GitHub-checks mock: rows `inspector audit ✔ signed r…`, `gps within site ✔`, `photos fresh ✔`, `no duplicate photo ✔`, `invoice = SoV line ✔`, `stage consistent (AI) ✔ 0.93` → **Released**. Caption: "A licensed inspector is one of the tests. All green, or the money stays locked." | The idea judges remember |
| 5 | **LIVE** | "Live on XRPL devnet" + explorer QR | Execution |
| 6 | **Who can move the money, and when?** | Table below | Credibility |
| 7 | **Potential** | "Any building: Schedule of Values in, test suite out." · "Any auditor: humans today, drones and sensors through the same signed-audit interface." · "Any ledger rule: Smart Escrows (XLS-100) put the suite on-chain." · "Mainnet vote open Oct 2026." | Rubric: potential |
| 8 | **Business + ask** | Fee lines (protocol fields) · first-loss cover · Reg D 506(c) → Reg A+ · Ask: pilot with one community bank or private-credit fund · "Prototype, not an offer to invest." Closing line. | Impact |

**Slide 6 table:**

| Money | Who can move it | Enforced by |
|---|---|---|
| A live milestone escrow | **Nobody.** Only to this builder, or back to the project account after expiry | Ledger (destination immutable) |
| Release of one milestone | **The test suite**: deterministic checks + a licensed inspector's signed audit + AI judgement, every result attested on-chain **before** the finish | Platform release service (disclosed) + public attestations |
| Liquid funds in the project account (≈ 0 by design) | **3 of 4**: platform, builder, inspector, trustee | Ledger (SignerList) |
| Investor shares | Deposit only with `KYC_INVESTOR`; redeem at `RedemptionDate` | Ledger (closed-ended vault, permissioned domain) |
| Not yet on-chain | The suite's result as a ledger rule → Smart Escrows (XLS-100) | roadmap |

## 3. Demo beats

Pre-staged: **Project A** (Maple St duplex) verified, funded, closed, 3 escrows, M1 evidence + audit uploaded, M2 evidence (reused photo)
uploaded; **Project B** with an already-expired escrow. Nothing live waits on a ledger time gate.

| # | Beat | Screen (driver) | Tx | Line (presenter) | Fallback |
|---|---|---|---|---|---|
| D1 | Verified project | Marketplace **Verified** badge → builder page: fee tx, verification report (identity / feasibility / capability, MOCK labels), credential tx | `Payment`, `CredentialCreate/Accept` | "The builder pays to be checked. Our AI verifies identity, feasibility and capability, brings in an inspector when it needs eyes on site, and writes the result to the ledger as a credential." | Screenshot |
| D2 | Locked state | Project A: SoV → 3 milestones with their check lists; vault (phase, share price 1.00 → rises with repaid interest), loan, 3 escrows, money map | pre-staged | "Investors funded this project's vault. The Lending Protocol lent to a project account no single party controls, which locked every milestone into its own escrow. Two futures for this money: this builder, or back." | Screenshot |
| D3 | **Money shot** | M1: builder evidence → inspector app: signed audit (checklist green, photos, attestation tx) → project page **Run checks** → rows turn green like CI → AI verdict `pass 0.93` → **Released** → builder balance ticks | audit `AccountSet`, verdict `AccountSet`, `EscrowFinish` | "Every milestone has a test suite. The inspector audited the site and signed her report. The AI runs the checks over her audit and the builder's evidence. All green, the escrow releases. Seconds, not a week, and every check was on the ledger before the money moved." | Recorded clip |
| D4 | **Fraud held** | M2: **Run checks** → `no_duplicate_photo` red: "matches Oak Ave project photo, distance 3/64, taken 41 days before this escrow existed" → **Failed**, locked | verdict `AccountSet` (`fail`) | "Reused framing photo from another job. One red check and the suite fails. FinCEN lists 'receipts dated before the loan' as a classic marker. This is that check, automated." | Static card |
| D5 | **Ledger says no** | `/demo` → "Platform tries to release M2" → explorer: `tecCRYPTOCONDITION_ERROR` | failed `EscrowFinish` | "Here's us trying to release it anyway. The ledger refuses." | Cut first |
| D6 | Stall → refund | Project B: Keeper tick → `EscrowCancel` → `LoanPay` → vault liquidity up; portfolio "redeem opens <date>" | `EscrowCancel`, `LoanPay` | "If a project stalls, the escrow expires, the money can only return to the project account, which repays the vault. Investors redeem at maturity." | One sentence |

**Demo devices worth the hours**
1. **Checks panel that fills like CI** (WEB-03/04): the single visual that carries the metaphor. Reasons written for a projector.
2. **Inspector app on a second window** (INS-01..05): the human in the loop is literally on screen signing. `apps/inspector` has 0 lines today; if it slips, a signed-audit form inside `/demo`.
3. **"Ledger says no"** (DEMO-01): the only beat that *shows* the custody claim.
4. **Money map with live balances** (WEB-05, XRPL-09).
5. **Verification report with three sections** (WEB-08, VER-08): makes "AI-first, inspectors when necessary" concrete.
6. **Share price ticks up when a repayment lands** (LoanPay), with an "interest repaid" tooltip. Devnet books interest at payment, not at close.
**Skip:** failed 2-of-4 multisig (a `tef`, not recorded). Never submit a finish with the real fulfillment that could fail.

## 4. Script skeleton (3:00)

**P** presenter · **D** driver.

| Time | Beat | SAY (P) | SCREEN (D) |
|---|---|---|---|
| 0:00–0:20 | Hook | "In 2023, eight hundred investors put sixty-three million dollars into two real-estate deals on CrowdStreet. It was wired to the sponsor's own account and most of it was gone before a single deal closed. Nothing stopped it, because construction money still moves on PDFs and one party's say-so. **Construction money should move only when the building does.**" | Slides 1–2 |
| 0:20–0:35 | Gap | "Builders have reported eighteen straight quarters of tighter credit. Private credit fills the gap at twelve to fifteen percent, and the people supplying it can't see where a dollar goes. A bank draw takes five to fourteen business days." | Slide 2 |
| 0:35–0:55 | Mechanism | "Drawproof. A builder pays to have the project verified. Investors fund it through a native XRPL vault. The loan goes to a project account no single party controls, which locks each milestone in an escrow that can only pay the builder or go back. And every milestone has a test suite: a licensed inspector's signed audit plus the AI's checks on the evidence. All green, release." | Slides 3–4 |
| 0:55–1:05 | D1 | (D1 line) | Marketplace → builder |
| 1:05–1:15 | D2 | (D2 line) | Project A |
| 1:15–1:50 | D3 | (D3 line) | Inspector app → Run checks → explorer |
| 1:50–2:05 | D4 | (D4 line) | M2 red check |
| 2:05–2:15 | D5 | (D5 line) | Explorer `tec` |
| 2:15–2:30 | D6 | (D6 line) | Project B |
| 2:30–2:45 | Honesty + potential | "Who can move the money? A live escrow: nobody. A release: the test suite, with a licensed inspector as a required check, attested on-chain first. The project account: three of four. Next: any building through its Schedule of Values, any auditor through the same signed-audit interface, including drones and sensors, and the suite itself as an on-chain rule with Smart Escrows." | Slides 6–7 |
| 2:45–3:00 | Business + close | "Builders pay a verification fee; we earn origination and a management fee, both native Lending Protocol fields, plus inspections. We post first-loss, so we lose first if we verify badly. Launch is accredited-only through credential-gated vaults. Devnet prototype, not an offer to invest. **Drawproof: investors fund verified projects, and the money moves only when each stage passes its tests.**" | Slide 8 |

**Cut order:** D5 → D6 to one sentence → drop the 12–15% line → compress Mechanism. **Never cut D3 or D4.**
**Pre-flight:** prestage A/B(/C), warm verifier cache, builder trust line verified, explorer tabs, backup video, 1280×720.

## 5. Q&A ownership (answers in `docs/07-pitch.md`)

| Q | Who answers |
|---|---|
| 1 AI as oracle · 2 platform holds release key · 11 why blockchain · 12 devnet | @Jalil-g |
| 3 inspector accountability · 4 collusion · 5 EXIF · 16 robots | @elmir132 |
| 6 skyscrapers / SoV · 7 builder fee · 9 interest on undrawn | @seanpatrickmay |
| 8 default · 10 liquidity · 13 securities · 14 RLUSD freeze | @bri-yin |
| 15 hardware wallet · sponsor curveballs | @RoroDev2023 |

## 6. Name

Open. Recommendation **Drawproof**. Decide by T+6h.
