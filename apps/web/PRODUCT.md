# Product

<!-- impeccable:product-schema 1 -->

Scope: `apps/web` (Drawproof investor/builder app + `/demo` control room). Product truth lives in `docs/00-overview.md`,
`docs/02-product.md` and `docs/decisions.md`; this file is what UI work needs from them.

## Platform

web (Next.js, desktop first; the demo runs on a projector at 1280×720)

## Users

- **Investor** (KYC'd, accredited): picks a verified project, deposits RLUSD into its vault, then watches where the money is.
- **Builder**: pays the verification fee, gets a verification report, uploads evidence per milestone, runs the checks, gets paid.
- **Platform operator**: locks terms, closes loans, resolves `needs_human` milestones with a signed reason, runs the demo.
- **Judges / audience** (the demo): must understand in one glance which checks passed, which failed and why, and whether money moved.

## Product Purpose

A construction loan whose money moves only when each stage passes its tests. Every milestone's RLUSD sits in an XRPL escrow
that can pay only the builder or go back. A milestone's test suite (a licensed inspector's signed audit plus the AI's checks)
must be green before the platform's release service finishes the escrow. Every check result is attested on-chain first.

## Positioning

GitHub checks for construction draws: one row per check with its reason and its on-chain proof, then Released / Failed /
Needs review. The ledger fixes *where* money can go; the suite makes *when* public.

## User stories (the UI must make each one obvious)

1. As an investor, I see verified projects with how much is raised and the rate, and I can invest in one step.
2. As an investor, I see exactly where my money is now (vault, locked in escrow, released, back) and when I can withdraw.
3. As a builder, I pay the verification fee and read my verification report (identity, feasibility, capability; MOCK labelled).
4. As a builder, I upload evidence for the current milestone, run the checks, and see which check failed and what to fix.
5. As anyone, on a milestone I see each check green or red with a reason and a link to its attestation, and the release tx.
6. As the operator, I approve or reject a `needs_human` milestone with a reason, and I can show the ledger refusing a release.

## Capabilities and Constraints

- Data only through `lib/api.ts` (routes 1–23 of `docs/05-api.md`). No business logic in the app.
- `NEXT_PUBLIC_API_MODE=mock` must say so on screen. Mock tx hashes never link to the explorer.
- Devnet only. Every real tx shows an explorer link.

## Brand Commitments

- Name: **Drawproof**. Line: "Construction money that moves only when the building does."
- Visual bar (user decision, 2026-10-24): **simple, like Apple's and Notion's web design**. Familiar, quiet, exact. No theme
  costume, no decoration. See `DESIGN.md`.
- Say: the ledger fixes where money goes; the suite decides when. Don't say: "trustless AI", "ledger-enforced release",
  "mainnet-ready", "automatic refunds to investors". Share value is booked at LoanSet; refunds are withdrawable from RedemptionDate.

## Evidence on Hand

Mock fixtures (`lib/mock/fixtures.ts`): Maple St (demo), Birch Rd (stall), Oak Ave (repaid), Cedar Ln (draft), Elm St (funding).
Registries, KYC and cost tables are mocks and must be labelled MOCK where shown. No real customers, testimonials or metrics exist.

## Product Principles

1. The verdict is the interface: status is shown with words and color, never color alone.
2. One primary action per screen.
3. Show the proof: every claim of "attested" or "released" carries its tx.
4. Honest about mock vs devnet, and about what the platform runs vs what the ledger enforces.
