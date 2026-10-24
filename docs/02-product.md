# 02 — Product

**Name:** **Drawproof** (decided 2026-10-24; see `docs/ideas/names.md`) · **Track:** XRPL Lending & Borrowing ·
**Event:** AI & Fintech XRPL Hackathon NYC, Oct 24–25 2026 (36h)

**Pitch line:** *Investors fund verified projects, and the money moves only when each stage passes its tests.*

**One metaphor for the whole product: a GitHub release pipeline for construction draws.** Every milestone has a test suite.
A licensed inspector audits the site and files a signed report. The AI runs the suite over the builder's evidence and the
inspector's audit. All checks green → the milestone's escrow releases. Any check red → the money stays locked and everyone
can see which check failed and why.

> Direction set 2026-10-24 (Jalil): AI-first with humans where necessary. Inspectors are the eyes on site, not the release
> key. Verification (of the project *and* each milestone) is run by the platform's AI; inspectors are brought in when the AI
> needs a site visit or escalates. Roadmap: robots and sensors replace part of the site audit.

## Roles

| Role | Does | On-chain identity |
|---|---|---|
| **Builder** (contractor / borrower) | Pays a **per-project verification fee**, submits identity/licence/insurance docs and the project's **Schedule of Values** (SoV), uploads evidence per milestone, repays | XRPL account + `VERIFIED_BUILDER` credential (issued on first verified project) |
| **Investor** | Browses **verified projects** on the marketplace, deposits RLUSD into that project's Vault, watches every check and release live | XRPL account + `KYC_INVESTOR` credential; holds vault share tokens |
| **Inspector** | Licensed third party already on the platform. **Assigned automatically by the AI** per project (region, trade, availability, load). Audits the site when the suite requires it or the AI escalates, files a **signed audit report** | XRPL account + `VERIFIED_INSPECTOR` credential; signer on the project account; signs audit attestations |
| **AI verifier** (platform service) | (1) **Project verification**: builder identity, project feasibility, builder capability. (2) **Milestone test suite**: runs every check over evidence + audit, produces a verdict, and triggers release when all required checks pass | Attestation account (`aiAgent`): verdict hashes on-chain |
| **Platform** | Operates the marketplace, vault + loan broker, credential issuance, release service and keeper; posts first-loss cover; human operator handles `needs_human` escalations | Vault owner = LoanBroker owner, credential issuer, 1 of 4 signers on the project account, release-service key holder |
| **Trustee** | Independent 4th signer on the project account (investor representative) | signer |

## End-to-end flow

1. **Builder pays to get a project verified** — a flat RLUSD payment to the platform (on-chain, explorer link). This funds the AI
   review and any inspector time. *"You pay to be checked, not to be listed."*
2. **Project verification (AI-first, inspectors when necessary)** — the AI assesses three things and writes a structured report:
   - **Builder identity**: licence active, insurance in force, name/entity match, sanctions (mock registries, clearly labelled).
   - **Project feasibility**: the SoV adds up, line items are within market ranges for the region, permits/plans present, site exists (geo), timeline realistic.
   - **Builder capability**: track record (completed projects, prior milestone history on the platform), capacity vs. open projects, risk tier.
   Any `needs_human` → an inspector is assigned for a pre-construction site visit and/or a platform operator reviews. Outcome:
   `VERIFIED_BUILDER` credential (first time) and the project is marked **verified** and listed.
3. **Schedule of Values → milestones** — the builder submits the project's SoV (the industry's draw standard, AIA G702/G703).
   For small residential, **templates are pre-filled SoVs** the builder can start from. The AI maps SoV lines to milestones and
   attaches each milestone's **required evidence and checks** (the test suite). The builder does not get to define "done".
4. **Approve and lock terms** — platform locks SoV, milestones, test suite, loan terms. The AI **assigns the inspector(s)** for
   the project from the verified panel. Terms and assignments are immutable from here (the escrow conditions depend on them).
5. **Fund** — `KYC_INVESTOR` holders deposit RLUSD into the project's closed-ended Vault and receive share tokens. The funding
   deadline is the vault's on-chain `SubscriptionDate`.
6. **Close** — after the deadline, the vault lends the full principal (`LoanSet`, countersigned by the project account's
   multisig) to the **project account**; the project account immediately locks each milestone's amount in its own **escrow**
   payable to the builder.
7. **Per milestone, the release pipeline:**
   1. Builder uploads evidence (photos, invoices, documents) against the milestone's required list.
   2. The assigned inspector audits the site and files a **signed audit report** (checklist per SoV line, photos, notes).
      Signed with the inspector's own key as an on-chain attestation.
   3. The AI runs the **test suite**: deterministic checks (GPS vs site, timestamps vs escrow, duplicate-photo hashes,
      invoice vs SoV line, audit present and signed by the assigned inspector) plus AI judgement (stage visually consistent,
      audit consistent with evidence, documents consistent). Verdict + per-check results are attested on-chain.
   4. **All required checks pass → release** (`EscrowFinish`, RLUSD lands in the builder's account in seconds).
      **Any required check fails → locked**; the builder resubmits or the inspector re-audits.
      **Low confidence → `needs_human`**: a platform operator reviews and approves/rejects with a signed reason.
8. **Stall** — escrow expires → anyone cancels → money returns to the project account → project account repays the vault
   (`LoanPay`) → investors redeem at the redemption date. **Repay** — builder repays into the project account → `LoanPay`.
   (Share value rises as interest is repaid (devnet-verified); repayments also turn principal back into withdrawable liquidity.)

## Demo focus (what judges see)

**Verification + the milestone test suite + escrowed release.** Everything else is the thinnest version that makes the story
run. See `docs/04-demo-script.md` and `docs/08-pitch-storyline.md`.

## Non-goals (hackathon)

- Real KYC / licence-registry / permit integrations (mocked, clearly labelled).
- Secondary market for vault shares. Mobile apps. Mainnet. Real RLUSD (mock IOU on devnet).
- Robot/sensor site audits (roadmap slide only).
- Large commercial SoVs beyond the demo's residential template (the SoV model supports them; the demo doesn't show one).

## Anti-goals (would make this a failure even if it "works")

- A platform that can **redirect** investor money. The escrow destination is fixed at creation; our key can only release to
  the builder or let it return. If we can send it anywhere else, we lost the plot.
- An AI that "approves construction quality" alone. The suite requires a licensed inspector's signed audit as an input.
- A demo that is a slide deck. Every step is a real devnet transaction with an explorer link.
- Hiding what the ledger enforces vs. what the platform runs. Slide 6 ("Who can move the money?") says it plainly.
