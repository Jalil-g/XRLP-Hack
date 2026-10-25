# Decisions log

Format: `- [date] DECISION — why (who)`. Mark open questions under **Open**.

## Decided (team)

- [10-24] Lending & Borrowing track; build *with* XLS-65 Vaults + XLS-66 Lending Protocol. (team)
- [10-24] Money pools into a per-project account no single party controls (multi-sig). (team)
- [10-24] Builders set terms from standard templates; investors choose to fund; platform approves; terms lock. (team)
- [10-24] RLUSD-denominated (mock RLUSD IOU on devnet). (team)
- [10-24] Releases are multi-sig approvals; AI verification varies by project type / builder / risk. (team)
- [10-24] Demo focus = verification + escrowed disbursement; everything else supports it. (team)

## Calls made by Sean's agent (challenge freely)

- [10-24] **Design B**: vault lends full principal to SPV; SPV locks each milestone in its own escrow. Chosen over
  "one loan per milestone" because it makes escrow the visible centerpiece. Cost: interest accrues on full principal. 
- [10-24] Devnet (Vault/Loan only enabled there).
- [10-24] TypeScript pnpm monorepo, Next.js web, xrpl.js 5.3.0, Anthropic SDK for verifier, JSON-file store.
- [10-24] ~~SPV SignerList quorum 3: inspectors weight 2, AI 1, platform 1~~ → superseded: `{platform, builder, inspector, trustee}` w1 each, quorum 3; AI off the list (see 03-architecture).
- [10-24] ~~Escrow gating via 2-of-3 Shamir-split preimage~~ → superseded: unique inspector-generated preimage per escrow; AI/platform approvals are on-chain attestations.
- [10-24] Closed-ended vault per project (required by `LendingProtocolV1_1` on devnet): SubscriptionDate = funding deadline, RedemptionDate = maturity + buffer.
- [10-24] LoanSet: platform = `Account` (single-sig), SPV = `Counterparty` multisig (xrpl.js helper constraint); `tfLoanOverpayment`, `PaymentTotal >= 2`, non-zero interest, zero late fees.
- [10-24] Platform posts first-loss cover via `LoanBrokerCoverDeposit` (CoverRateMinimum 10%, liquidation 100%).

## Direction v2 (Jalil, 2026-10-24 evening) — supersedes the inspector-held-key model

- [10-24] **Release = milestone test suite.** Like a GitHub release: a licensed inspector audits the site and files a signed report; the AI runs
  the suite (deterministic checks + judgement) over builder evidence + inspector audit; all required checks pass → the platform's release
  service finishes the escrow. Inspectors do **not** hold a release key. `needs_human` → platform operator decides with a signed reason. (Jalil)
- [10-24] **Preimages are held by core's release service** (unique per escrow, encrypted at rest), disclosed on slide 6. Ledger enforces
  destination + expiry; the suite + on-chain attestations make release timing auditable. Smart Escrows (XLS-100) = roadmap. (Jalil)
- [10-24] **Per-project verification fee** paid by the builder in RLUSD on-chain; AI-first verification of builder identity, project feasibility
  and builder capability; inspectors only when the AI escalates (`needs_human` → pre-construction site visit). `VERIFIED_BUILDER` on first pass. (Jalil)
- [10-24] **Schedule of Values** (AIA G702/G703) defines milestones for any project size; residential templates are pre-filled SoVs. Demo = Maple St. (Jalil)
- [10-24] **Inspector assignment fully automated by AI** from a verified panel (`VERIFIED_INSPECTOR`), at lock-terms. Roadmap: robots/sensors through the same signed-audit interface. (Jalil)
- [10-24] **No hardware-wallet (Ledger device) work.** Software inspector key; `packages/ledger-signer` keeps the interface. (Jalil)
- [10-24] Sponsor stance: Lending & Borrowing track; AWS only as Bedrock provider swap if confirmed at booth; no Quicknode (no devnet), no Mastercard AP4M. (Jalil)
- [10-24] Marketplace framing kept: KYC'd investors choose verified projects; institutional lender = same rail, one depositor. (Jalil)
- [10-24] **Name: Drawproof.** (Jalil)
- [10-24] **Verification fee: 250 RLUSD in the demo.** In the product the fee **scales with project size** (e.g. bps of principal with a floor); the UI and the business slide must say so. (Jalil)
- [10-24] Tickets v2 in `docs/06-tickets.md`; GitHub issues synced. Retired: INS-04/05/08/09 v1. New: XRPL-14, VER-13, VER-14, INS-06/07 v2, CORE-12, DEMO-01, PITCH-09.
- [10-24] XRPL-01 proven with the v2 SPV list (3-of-4 counterparty countersign incl. platform as both Account and signer); no master-key fallback needed. Spikes use fresh throwaway faucet wallets (`scripts/spike-lib.ts`), not the bootstrap store. (Jalil's agent)
- [10-24] Submissions lock per account through validation, always set LastLedgerSequence (margin 20, `XRPL_LLS_MARGIN`), and retry only transient results. A new blob is signed only once the old one provably can't apply (same Sequence re-sign; fresh Sequence only on tefPAST_SEQ for a never-sent blob). Throughput is ~1 tx/ledger per account, which is fine for the demo. Why: 20 parallel raw submits gave 19× tefPAST_SEQ on devnet. (Jalil's agent, XRPL-12)
- [10-24] XRPL-02 proven on devnet with the v2 SPV: multisig IOU EscrowCreate, finish by a separate releaseService, `tecCRYPTOCONDITION_ERROR` / `tecNO_LINE` / `tecNO_PERMISSION` all on-ledger; a failed finish publishes the fulfillment, so preflight (XRPL-14) is mandatory before any fulfillment is signed (Jalil's agent, XRPL-02)
- [10-24] Bootstrap roles v2: `issuer, platform, releaseService, builder, investor1..3, inspector1..3, aiAgent, trustee`. RLUSD trust lines only for holders (`platform, builder, investor1..3`); signer-only roles (releaseService, trustee, inspectors, aiAgent) get none. Mint: investors 50k, platform 25k (cover for several prestaged projects), builder 1k (≥ 250 fee). v1 `inspectorA/B` renamed to `inspector1/2` (same account), unknown roles kept under `retired`. Until XRPL-05, SPV list stays v1-shaped with inspector1/2 in the inspector slots and default signers platform + inspector1 (builder isn't on that list yet). (Jalil's agent, XRPL-03)
- [10-24] SPV default multisig quorum = platform + builder + trustee (any 3 of 4 is valid). These are fixed per project whichever inspector the AI assigned; callers pass the inspector explicitly when it should sign. `submitMultisigned` checks quorum against the on-ledger SignerList before submitting, because xrpl.js `submitAndWait` hangs ~1 min on `tef*` instead of throwing (Jalil's agent, XRPL-05)

## Open

- Product name.
- Judging rubric + submission deadline + demo length — ask organizers on site.
- Interest on full principal from day one (design B) — acceptable for demo? Note `InterestRate=0` risks `tecPRECISION_LOSS`; use a small rate.
- Under-funded at `SubscriptionDate` → investor money locked until `RedemptionDate`. Policy: platform tops up? short redemption window? cap with `AssetsMaximum`?
- Trustee identity for the 4th SPV signer (investor rep). Demo: server-held, disclosed.
- Verify on devnet in hour 1: multisig-counterparty `LoanSet` (XRPL-01). If it fails → fallback documented in xrpl-protocol-notes §2.
- Per-payee escrows (subcontractors + lien waivers): roadmap line only (VER-12 stretch).
- Default handling for already-released money (collateral / lien story for the pitch).
- AWS Lending slice: undecided (Jalil not sure). Only do the Bedrock swap (VER-14) if the booth confirms it qualifies and the demo is green at T+24h.
