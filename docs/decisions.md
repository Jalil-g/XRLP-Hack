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

## Open

- Product name.
- Judging rubric + submission deadline + demo length — ask organizers on site.
- Who has a Ledger device (Ledger bounty: inspector signs on device)?
- Interest on full principal from day one (design B) — acceptable for demo? Note `InterestRate=0` risks `tecPRECISION_LOSS`; use a small rate.
- Under-funded at `SubscriptionDate` → investor money locked until `RedemptionDate`. Policy: platform tops up? short redemption window? cap with `AssetsMaximum`?
- Trustee identity for the 4th SPV signer (investor rep? second inspector?).
- Verify on devnet in hour 1: multisig-counterparty `LoanSet` (XRPL-01). If it fails → fallback documented in xrpl-protocol-notes §2.
- Product pivot under consideration: per-payee escrows (builder + subcontractors, lien waivers) and institutional lender framing — see 06-tickets "If we pivot".
- Default handling for already-released money (collateral / lien story for the pitch).
