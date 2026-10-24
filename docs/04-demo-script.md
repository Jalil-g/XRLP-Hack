# 04 — Demo script (3:00, protocol-accurate, test-suite release model)

Every step is a live devnet tx with an explorer link on screen. Full speaker script, slides and cut order: `docs/08-pitch-storyline.md`.
Pre-staged (XRPL-11 `--prestage` + CORE-07): **Project A** (Maple St duplex) verified, funded, loan closed, 3 escrows locked,
Milestone 1 evidence + inspector audit uploaded, Milestone 2 evidence (reused photo) uploaded; **Project B** with an escrow whose
`CancelAfter` is already past. Nothing live waits on a ledger time gate.

| # | Beat | Screen | Tx | Line |
|---|---|---|---|---|
| 0 | Problem (0:00–0:35) | Slides 1–2 | — | Nightingale $63M; draws on PDFs, 5–14 days; 18 quarters tighter credit. "Construction money should move only when the building does." |
| 1 | Verified project (0:35–0:50) | Marketplace card: **Verified** badge → builder page: fee tx, verification report (identity ✔ feasibility ✔ capability ✔, MOCK labels), `VERIFIED_BUILDER` credential | `Payment` (fee), `CredentialCreate/Accept` | "The builder pays to be checked. Our AI verifies identity, feasibility and capability, pulls in an inspector when it needs eyes on site, and the result is a credential on the ledger." |
| 2 | Locked state (0:50–1:05) | Project A detail: SoV → 3 milestones with their **check lists**; vault panel (phase Investment, share price 1.00, rises as interest is repaid); loan panel; 3 escrows with explorer links; money map | `VaultDeposit`×3, `LoanSet`, `EscrowCreate`×3 (pre-staged) | "Investors funded this project's vault. The Lending Protocol lent to a project account no single party controls. It locked every milestone into its own escrow. This money has two futures: this builder, or back." |
| 3 | **Money shot** (1:05–1:45) | Milestone 1: builder evidence; inspector app: signed audit (checklist green, photos); back to project: **"Run checks"** → checks panel fills like CI: 8 green rows with reasons, inspector audit ✔ signed by `r…`, AI verdict `pass` 0.93 → **Released** → builder balance ticks | `AccountSet` (inspector audit attestation), `AccountSet` (AI verdict attestation), `EscrowFinish` | "Every milestone has a test suite. The inspector audited the site and signed her report. The AI runs the checks over her audit and the builder's evidence. All green, so the escrow releases. Seconds, not a week, and every check is on the ledger before the money moved." |
| 4 | **Fraud held** (1:45–2:05) | Milestone 2: checks panel: `no_duplicate_photo` **red**: "matches Oak Ave project photo, distance 3/64, taken 41 days before this escrow existed"; status **Failed**, escrow still locked | AI attestation (`fail`) | "Reused framing photo from another job. One red check, the suite fails, the money stays locked. FinCEN lists 'receipts dated before the loan' as a classic draw-fraud marker. This is that check, automated." |
| 5 | **Ledger says no** (2:05–2:15) | `/demo` → "Platform tries to release M2" → explorer shows `tecCRYPTOCONDITION_ERROR` | failed `EscrowFinish` | "Here's us trying to release it anyway. The ledger refuses. The CrowdStreet failure, made structural." |
| 6 | Stall → refund (2:15–2:30) | Project B: expired escrow → "Keeper tick" → `EscrowCancel` → `LoanPay` → vault `AssetsAvailable` up; portfolio: "redeem opens <date>" | `EscrowCancel`, `LoanPay` | "If a project stalls, the escrow expires, the money can only go back to the project account, which repays the vault. Investors redeem at maturity." |
| 7 | Who can move the money (2:30–2:45) | Slide 6 table | — | "Live escrow: nobody. Release: the test suite, with a licensed inspector's signed audit as a required check, every result attested on-chain first. Project account: three of four. Next: the suite's result as an on-chain rule, via Smart Escrows." |
| 8 | Business + close (2:45–3:00) | Slide 8 | — | Per-project verification fee, origination and management fees (protocol fields), inspection per draw, first-loss cover. "Prototype, not an offer to invest." Pitch line. |

**Cut order if over:** beat 5 → beat 6 to one sentence → compress beat 0. **Never cut beats 3 and 4.**
**Never narrate a spinner**: while a tx is pending, speak the honesty line.
