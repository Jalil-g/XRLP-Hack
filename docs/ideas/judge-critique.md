# Idea: Judge-perspective critique (adversarial review, 10-24)

> **Status 2026-10-24: superseded by direction v2** (`docs/decisions.md`, `docs/03-architecture.md`). Holes 2a/2b were resolved differently: release is the platform-run test suite (disclosed), SPV list is platform/builder/inspector/trustee. Kept for history.

- **Author / agent:** devils-advocate agent (Sean's session)
- **Status:** 2a + 2b fixes adopted into the XRPL design; pivot (§5) awaiting team decision

## Real-need verdict
Pain 3 (draw process) is the sharpest. Pain 1 (expensive credit) is real but our design doesn't lower rates (design B charges
interest on undrawn money). Pain 2 rests on Trustpilot — weakest evidence — and retail investors invite the securities question.
→ **Lead with Pain 3.**

Alternatives ranked (judge-wow × real need × buildable):
1. **Pay subs directly + institutional lender** (private credit fund / community bank). Each milestone = one escrow *per payee*
   (builder + 2–3 subs). AI matches invoices ↔ conditional lien waivers ↔ budget lines. Kills mechanics'-lien risk. Small code
   change (N escrows instead of 1), better Mastercard/payments story, fits a permissioned vault better than retail.
2. Current concept with an institutional lender instead of retail (same build, no Reg D objection).
3. ADU / affordable housing as demo persona only.
4. Sub-payment-only without a loan — leaves the lending track. Don't.

## Design holes
- **2a BLOCKING — release isn't multisig.** SignerList doesn't govern EscrowFinish; the preimage holder releases. A service that
  generates then Shamir-splits the preimage knows it → theater. **Fix (adopted):** inspector's client generates a unique preimage per
  escrow, only the condition goes on-chain; platform never sees it. AI + platform approvals = on-chain memo attestations.
- **2b — platform holds 2 of 3 quorum weight** (AI key + platform key). Platform + one inspector could drain SPV liquid funds or
  rewrite the signer list. **Fix (adopted):** create escrows right after LoanSet so SPV holds ~0; say the collusion bound out loud.
- **2c — interest on undrawn principal** contradicts Pain 1. Low rate + call it a commitment fee; show all-in cost vs NAHB's 11.68%.
- **2d — refunds aren't automatic to investors.** EscrowCancel → SPV; needs multisigned LoanPay; vault illiquid while lent out.
  Say "locked for the loan term."
- **2e — default after release.** Platform first-loss via `LoanBrokerCoverDeposit`; deed of trust / lien as off-chain backstop.
- **2f — oracle.** EXIF is spoofable. Defensible AI value: cross-project perceptual-hash dedupe + invoice ↔ lien waiver ↔ budget matching.
- **2g — "minutes not days"** is post-inspection lag, not inspection time. Phrase precisely.

## Demo risks
Multisigned LoanSet countersign is the least-tested path → prove in hour 1. No time travel → escrow 3 CancelAfter ≈ 150s.
Devnet resets / faucet limits → idempotent bootstrap < 2 min + pre-recorded fallback. Claude vision latency 10–30s → spinner.
Share-value growth invisible in 3 min → exaggerate rate or show origination fee.

## Scope cuts suggested
Shamir; onboarding AI (issue credential via script); two-inspector rule; funding deadline; resubmit loop; per-type policies
(one template); repay UI; four role views → one "control room" page. Ledger only if someone owns one. Keep Permissioned Domain +
private vault if < 2h.
