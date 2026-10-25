# 06 — Team plan, timeline & tickets (36h) — v2, test-suite release model

Read first: `docs/02-product.md`, `docs/03-architecture.md`, `docs/xrpl-protocol-notes.md`, `docs/05-api.md`.
**v2 (2026-10-24, Jalil):** rewritten for the direction change: release = milestone test suite run by the platform AI; inspectors
audit and sign (no release key); AI-first project verification paid per project; AI-assigned inspectors; Schedule of Values.
GitHub issues mirror this file 1:1 (title = heading). IDs are stable; retired tickets are listed at the bottom.
Sizes: **S** ≤ 1.5h · **M** 2–3h · **L** 4–5h.

## Owners (disjoint directories)

| Who | Label | Owns |
|---|---|---|
| **@Jalil-g** | `area:xrpl` | `packages/xrpl/**`: money path, credentials (3 roles), fee payment, private vault, bootstrap/prestage/demo scripts, `adapter.ts` = `LedgerPort` |
| **@elmir132** | `area:verifier` | `packages/verifier/**`, `fixtures/**`: project verification, milestone test suite (checks + Claude), inspector matching, fixtures, `adapter.ts` = `VerifierPort` |
| **@bri-yin** | `area:web` | `apps/web/**`: marketplace (verified projects), project detail with **checks panel**, invest, portfolio, builder onboarding (fee → verification), create project from SoV, `/demo` |
| **@RoroDev2023** | `area:inspector` | `apps/inspector/**` (:3001) + `packages/attest-signer/**`: queue, **audit form**, signed audit submission, audit history; attestation signing (software key) |
| **@seanpatrickmay** | `area:core` | `packages/core/**` (orchestrator, **release service**, HTTP, keeper, store, adapters), `packages/shared/**` (contract), root/CI, `docs/05-api.md`, integration |
| everyone | `area:pitch` | `docs/**`, `pitch/**` |

Contracts between lanes: `packages/shared` (types + `ports.ts`) and `docs/05-api.md`. Changing one = PR reviewed by producer + consumers.

## Timeline (T0 = kickoff)

| When | Checkpoint | Must be true |
|---|---|---|
| **T+1h** | De-risk | XRPL-01/02 on devnet. CORE-01 contract PR open. PITCH-01 rubric asked. |
| **T+6h** | **Integration 0: fake mode** | typecheck + tests green on `main`. Both apps click the full flow against core on fakes: fee → verify → lock → fund → close → evidence → audit → run checks → release / fail. Mock verifier deterministic. |
| **T+14h** | **Integration 1: devnet** | `LEDGER_MODE=devnet`: the same flow from the UIs with explorer links, incl. AI + audit attestations before the finish. |
| **T+24h** | Feature complete | Full demo (verified project, money shot, fraud held, ledger-says-no, stall) runs twice after `demo/reset`. Deck v1. Rehearsal 1. |
| **T+28h** | Hardening | Punch list fixed. Backup video. Rehearsal 2. |
| **T+32h** | Code freeze | Tag `demo-v1`. |
| **T+33–35h** | Rehearsals 3–4, submit ≥30 min early | |

## Scope cuts (agreed; don't build)

- No inspector-held preimages, no Shamir, no XOR split, no client-side condition check (retired INS-04/05/08).
- **No hardware-wallet (Ledger device) work** (retired INS-09; Ledger clip dropped from PITCH-08).
- One SoV in the demo (`residential_new` template → Maple St duplex, 3 milestones). Large commercial SoV = roadmap slide.
- Credentials + permissioned domain set up by script (XRPL-08). UIs show badges.
- No repay UI (control-room button). No rotation beyond assignment. No secondary market. No real KYC/registries. No SSE. No mobile.
- Stretch only: Batch close (XRPL-13), lien waivers (VER-12), live vision (VER-04 if cache + real photos ready), Bedrock provider swap (VER-14).

## How to run 5 AIs without stepping on each other
(unchanged from v1: one ticket = one branch = one worktree; stay in your lane; contract PRs via @seanpatrickmay; own `WALLETS_FILE`;
handoff comments on the issue with the `HANDOFF` template; PRs ≤ ~400 lines, typecheck + tests green, squash-merge.)

---

## area:xrpl — @Jalil-g

### XRPL-01 · Hour-1 spike: multisig-counterparty LoanSet on a closed-ended vault
`size:S` `demo-critical` `checkpoint:T+1h`. Unchanged from v1 **except**: use the **new signer list** (platform/builder/inspector/trustee, w1, quorum 3, 3 counterparty signers). Record tx hashes in `docs/xrpl-protocol-notes.md` §2 (not only in `.data`). Also record: open-ended `LoanBrokerSet` → `tecNO_PERMISSION`; `LoanSet` before SubscriptionDate → `tecTOO_SOON`.

### XRPL-02 · Hour-1 spike: IOU conditional escrow finish + cancel (+ the two demo-critical failure codes)
`size:S` `demo-critical` `checkpoint:T+1h`. As v1, plus prove: (a) **wrong-fulfillment finish → `tecCRYPTOCONDITION_ERROR` is recorded on-ledger with an explorer link** (needed for DEMO-01); (b) finish to a builder **without** a trust line → `tecNO_LINE` and the fulfillment is public afterwards (motivates XRPL-14).

### XRPL-03 · Idempotent bootstrap: wallets, issuer, trust lines, RLUSD
`size:M` `demo-critical` `checkpoint:T+6h`. As v1, plus accounts `releaseService`, `trustee`, `inspector×3` (panel). Mint RLUSD to the builder for the verification fee.

### XRPL-04 · Closed-ended vault, LoanBroker, first-loss cover (real rates), fees
`size:M` `demo-critical` `checkpoint:T+6h`. As v1, plus **AC:** `CoverRateMinimum=10000`, `CoverRateLiquidation=100000` set on `LoanBrokerSet`; `LoanBrokerCoverDeposit` mandatory with a `cover_deposited` event; `ManagementFeeRate` and `LoanOriginationFee` non-zero so the business slide is on the explorer.

### XRPL-05 · SPV account + generic multisig submit (new signer list) — **moved to T+6h**
`size:M` `demo-critical` `checkpoint:T+6h`. `createSpv()` = SignerListSet `{platform, builder, inspector, trustee}` w1 each, quorum 3, then `asfDisableMaster`. `submitMultisigned()` autofills with signer count. Devnet test: 2 sigs fail, 3 succeed. Replaces the old inspectorA/B w2 / aiAgent w1 list in `spv.ts`/`api.ts`.

### XRPL-06 · Loan close: countersigned LoanSet + N multisig escrows (conditions supplied by core)
`size:L` `demo-critical` `checkpoint:T+14h`. `loanSetCountersigned` (platform Account, SPV counterparty multisig, `tfLoanOverpayment`, `PaymentTotal ≥ 2`, `InterestRate > 0`, zero late fees, **fee set by hand**). `escrowCreateMultisig ×N` immediately after, with `condition_i` **passed in by the release service** (CORE-12) and `CancelAfter_i < maturity` checked. Rejects duplicate conditions. Devnet test: SPV liquid RLUSD ≈ 0 after close. Delete `condition.ts` preimage generation from this package (moves to core).

### XRPL-07 · Finish, cancel, repay, withdraw
`size:M` `demo-critical` `checkpoint:T+14h`. `escrowFinish` (submitter = `releaseService`, fee sized for fulfillment, generous LLS), `escrowCancel`, `builderPayToSpv`, `loanPayMultisig({overpayment})`, `vaultWithdraw` (`TooSoonError`). Devnet test: finish → repay → withdraw after RedemptionDate.

### XRPL-08 · Attestations, credentials ×3 roles, fee payment, permissioned domain, private vault
`size:M` `demo-critical` `checkpoint:T+14h`. `attest({signer, memo})` with memo type `xrlp/attest/v1` and kinds `audit|verdict|decision|release` (round-trip test). `payVerificationFee(builder → platform)`. `issueCredential` + `acceptCredential` for `VERIFIED_BUILDER`, `VERIFIED_INSPECTOR`, `KYC_INVESTOR`. `createDomain`, private vault. `scripts/compliance.ts`: investor3 without KYC → deposit `tecNO_AUTH` (explorer link).

### XRPL-09 · Read models: vault, loan, escrow, balances
`size:S` `demo-critical` `checkpoint:T+14h`. `getVault`, `getLoan`, `getEscrow(owner, seq)`, `getBalance(account, RLUSD)` for the money map. Parsers tested on recorded devnet JSON.

### XRPL-10 · `XrplLedgerAdapter implements LedgerPort`
`size:L` `demo-critical` `checkpoint:T+14h`. Every method in `docs/05-api.md` §3 incl. `preflightFinish`, `payVerificationFee`, `issueCredential`, `submitSignedBlob`. Error mapping → `ErrorCode`. Core e2e passes with `LEDGER_MODE=devnet`.

### XRPL-11 · End-to-end devnet demo script + pre-staging (fixed plan)
`size:L` `demo-critical` `checkpoint:T+24h`. `demo` runs the whole story as a CLI (backup). `--prestage` produces: **Project A** verified + funded + closed + 3 escrows (generous RedemptionDate); **Project B** with one escrow whose `CancelAfter` is **already past** and a **long `PaymentInterval`** (so the refund LoanPay is on time); **Project C** fully repaid and past `RedemptionDate` (withdrawable). Writes `.data/prestage.json` for CORE-07. Fix the `DEMO_WITHDRAW` timing comment.

### XRPL-12 · Submission hardening — **moved to T+14h**
`size:S` `demo-critical` `checkpoint:T+14h`. Per-account mutex, `LastLedgerSequence`, bounded retries (`terQUEUED`/`tefPAST_SEQ`/`telINSUF_FEE_P`), typed `XrplTxError`. 20 parallel deposits with no sequence errors.

### XRPL-13 · (Stretch) Atomic close via Batch
`size:M` `stretch`. Unchanged.

### XRPL-14 · Pre-reveal safety (`preflightFinish`)
`size:S` `demo-critical` `checkpoint:T+14h`. Before any finish: escrow exists + open, `CancelAfter` > now + margin, destination has RLUSD trust line, fee/LLS set. Returns `{ok, reason}`; never submits a finish expected to fail (a failed finish publishes the preimage). Devnet test with a trust-line-less builder → refused client-side. Document in 03 (done) and keep it there.

---

## area:verifier — @elmir132

### VER-01 · Demo fixtures with ground truth: evidence **and inspector audits** (real photos)
`size:M` `demo-critical` `checkpoint:T+6h`. `fixtures/evidence/maple-st/{foundation,framing,dry_in}/` with **real photos** (CC0/own) re-stamped via `stampExif` (GPS in geofence, timestamps after escrow), invoices matching SoV lines, footing-inspection doc. `framing/` includes a copy of a photo from `fixtures/evidence/oak-ave/` with a **fresh** EXIF date and a neutral filename (pHash alone must catch it). **New:** `audits/` with one `InspectorAudit` JSON per milestone (foundation: all `done`; framing: inspector marks sheathing `partial`) and one milestone with **no audit**. `manifest.json` gives expected outcome + failing checks. Sources + licences in `SOURCES.txt`. < 15 MB.

### VER-02 · Evidence preprocessing: EXIF, sha256, pHash
`size:M` `demo-critical` `checkpoint:T+6h`. Unchanged (DCT pHash already works; keep distance ≤ 10 fail, test the 3% crop edge).

### VER-03 · Deterministic checks incl. `inspector_audit_present`
`size:M` `demo-critical` `checkpoint:T+6h`. `required_evidence_present`, `gps_within_site`, `photo_fresh`, `no_duplicate_photo` (across **all** projects), `invoice_matches_budget` (vs SoV line), **`inspector_audit_present`** (audit exists, `inspector` ∈ assigned, `evidenceBundleHash` matches, attestation `txHash` present), `audit_checklist_complete` (no `not_done` lines). Reasons read well on a projector ("matches Oak Ave project photo, distance 3/64, taken 41 days before this escrow existed").

### VER-04 · AI judgement checks (Claude): `stage_visually_consistent`, `audit_matches_evidence`, `document_consistency`
`size:L` `demo-critical` `checkpoint:T+14h`. Live mode with the Anthropic SDK over builder photos + inspector photos + checklist + SoV visual criteria; zod-validated output; sha256-keyed disk cache; **client timeout + `maxRetries`**; image processing inside the fail-closed path; refusal/timeout → `needs_human`, never `pass`. Mock mode returns manifest outcomes. LLM-sourced numbers labelled as such.

### VER-05 · Invoice extraction + SoV match
`size:M` `checkpoint:T+14h`. ±10% pass / ±25% warn / else fail against the SoV line; mock via manifest; live via Claude. Text and PDF.

### VER-06 · Release policy per SoV line (`policyFor`)
`size:S` `demo-critical` `checkpoint:T+6h`. Pure, table-tested: required vs optional checks per project type / risk tier / amount; `minConfidence` 0.7/0.8/0.9; `requiredAudits` 2 when amount ≥ `TWO_INSPECTOR_THRESHOLD` or `riskTier=high`.

### VER-07 · Verdict assembly + canonical `verdictHash`
`size:S` `demo-critical` `checkpoint:T+6h`. Any required `fail` → `fail`; confidence < min → `needs_human`; else `pass`. `verdictHash` = sha256 of canonical JSON (sorted keys), exported for core's attestation. Snapshot tests. (The `'9f'.repeat(32)` placeholder in ledger-signer was removed with the v1 `AccountSet` builder in INS-04.)

### VER-08 · Project verification: identity, feasibility, capability (AI-first)
`size:L` `demo-critical` `checkpoint:T+14h`. `verifyProject(input)` → `ProjectVerification`: **identity** (licence active, insurance in force, entity match: mock registries labelled MOCK), **feasibility** (SoV sums to principal, line amounts within regional ranges from a mock cost table, permits/plans present, site geo resolves, timeline sane), **capability** (completed projects, open load, prior milestone pass rate, → `riskTier`). Any dimension `needs_human` → `inspectorPreVisitRequired=true`. Fixtures: Maple St (pass), one with expired insurance (fail), one with an SoV 40% over market (needs_human). Mock deterministic; live via Claude.

### VER-09 · `ClaudeVerifierAdapter implements VerifierPort`
`size:M` `demo-critical` `checkpoint:T+14h`. `verifyProject`, `verifyMilestone`, `assignInspector`, `policyFor`, `verdictHash` for `mock` and `live`. Core fake-mode e2e passes with `VERIFIER_MODE=mock`.

### VER-10 · Eval harness (mock + live)
`size:S` `demo-critical` `checkpoint:T+14h`. Over `fixtures/**/manifest.json` for both project verification and milestone suites. Live stable 3/3.

### VER-11 · Robustness: prompt injection, missing metadata, fail-closed
`size:M` `checkpoint:T+28h`. Adversarial fixtures (image text "APPROVED", injected audit notes, missing EXIF, wrong GPS) → `fail`/`needs_human`, never `pass`. Escape filenames and audit notes in prompts.

### VER-12 · (Stretch) Lien-waiver matching
`size:M` `stretch`. Unchanged.

### VER-13 · Inspector auto-assignment (`assignInspector`)
`size:S` `demo-critical` `checkpoint:T+6h`. Score the panel (`fixtures/inspectors.json`, 3 inspectors) by region distance, trade match to SoV, availability, open load, prior agreement with the suite; return top `count` with reasons. Deterministic; table-tested. Roadmap note in the reasons: "robot/sensor auditors use the same interface".

### VER-14 · (Stretch, AWS prize) Bedrock provider swap
`size:S` `stretch`. `VERIFIER_PROVIDER=bedrock` uses `AnthropicBedrock` with the same prompts/schemas. Only if the AWS booth confirms it qualifies and gives credits. Never commit creds.

---

## area:web — @bri-yin

### WEB-01 · Typed API client with mock/http switch (routes per 05 §2)
`size:S` `demo-critical` `checkpoint:T+6h`. One function per route 1–23; `NEXT_PUBLIC_API_MODE=mock|http`; rewrite to `CORE_URL`. **Remove business logic from `mock-data.ts`** (weights, auto-approve, share-price-on-repay). Visible **"mock"** badge while in mock mode. Typed `ApiError{code}`.

### WEB-02 · Marketplace of verified projects
`size:M` `demo-critical` `checkpoint:T+14h`. Cards: **Verified** badge (link to verification report), funding bar, deadline countdown, principal, rate, builder credential badge. Filter by type. Polls 5s.

### WEB-03 · Project detail = the demo screen (with the **Milestone checks panel**)
`size:L` `demo-critical` `checkpoint:T+14h`. SoV → milestone rail; per milestone a **checks panel styled like GitHub checks**: one row per check (icon, name, reason, evidence thumbnails, attestation link), inspector audit row with signer address + tx link, AI verdict row with confidence + hash link, outcome banner (Released / Failed / Needs human / Pending). Vault panel (phase, share price with "rises as interest is repaid" tooltip, AssetsAvailable, redeem date), loan panel, timeline, money map. Polls 3s.

### WEB-04 · Checks panel + verdict components
`size:M` `demo-critical` `checkpoint:T+6h`. `ChecksPanel`, `CheckRow`, `AuditRow`, `VerdictRow` from the shared types. `/dev/checks` renders pass, duplicate-photo fail, missing-audit fail, needs_human.

### WEB-05 · Audit timeline + money map (live balances)
`size:M` `demo-critical` `checkpoint:T+14h`. Timeline of `ChainEvent`s with actor role (builder/inspector/AI/release service/platform) + explorer link. Money map Vault → SPV → escrows → builder with balances from route 2 snapshots; subtle animation on release/refund.

### WEB-06 · Invest flow
`size:M` `demo-critical` `checkpoint:T+14h`. Unchanged (route 7; disabled after SubscriptionDate; KYC badge; `tecNO_AUTH` message).

### WEB-07 · Investor portfolio
`size:M` `checkpoint:T+24h`. Unchanged (route 20; withdraw only in Redemption).

### WEB-08 · Builder onboarding: pay fee → project verification report
`size:M` `demo-critical` `checkpoint:T+14h`. Upload/pick mock docs → **"Pay verification fee"** (route 4, TxToast + explorer) → **"Run verification"** (route 5) → report with three sections (identity / feasibility / capability), each check with reason and MOCK label; `needs_human` shows "inspector pre-visit assigned"; pass shows the `VERIFIED_BUILDER` credential tx and the project's Verified badge.

### WEB-09 · Create project from Schedule of Values
`size:M` `demo-critical` `checkpoint:T+14h`. Pick a template (pre-filled SoV) or upload/edit SoV lines (code, title, trade, amount); evidence + checks per line are **read-only** (that's the product point); lines must sum to principal; submit route 3. Show assigned inspector after lock-terms.

### WEB-10 · Builder milestone evidence upload + "Run checks"
`size:M` `demo-critical` `checkpoint:T+14h`. Drag-drop + "load Maple St fixture" → route 9. "Run checks" → route 11 → ChecksPanel fills; on pass shows the release tx; on fail shows the red row and "resubmit".

### WEB-11 · `/demo` control room
`size:M` `demo-critical` `checkpoint:T+14h`. Buttons: pay fee (4), verify project (5), lock terms (6), close (8, with SubscriptionDate countdown), run checks (11), **operator decision for needs_human (12)**, keeper tick (22), repay (14), **"Platform tries to release" (23)**, reset (21), open inspector app. Scene list mirrors `docs/04-demo-script.md`.

### WEB-12 · Projector polish + empty/error states
`size:S` `demo-critical` `checkpoint:T+28h`. Unchanged; friendly copy for every `ErrorCode` incl. `checks_failed`, `needs_human`, `unsafe_release`.

---

## area:inspector — @RoroDev2023

### INS-01 · Scaffold `apps/inspector` + API client
`size:S` `demo-critical` `checkpoint:T+6h`. Next.js app at :3001, `lib/api.ts` for routes 2, 10, 18 with mock/http switch, inspector identity picker (panel of 3 from demo wallets), `VERIFIED_INSPECTOR` badge.

### INS-02 · Inspector queue
`size:M` `demo-critical` `checkpoint:T+14h`. Route 18: tasks grouped by `needs` (`pre_visit` / `audit` / `re_audit`) with project, SoV line(s), amount, builder evidence status. Polls 5s.

### INS-03 · Audit form (the inspector's deliverable)
`size:L` `demo-critical` `checkpoint:T+14h`. Per milestone: SoV checklist (done / partial / not_done + note per line), photo upload with EXIF preview, site map pin vs photo pins, free notes, builder evidence gallery side-by-side (`/api/files/:id`). Builds an `InspectorAudit` incl. `evidenceBundleHash` of the builder's evidence they reviewed.

### INS-04 · Signed audit submission via `packages/attest-signer` (software key; rename from `ledger-signer`)
`size:M` `demo-critical` `checkpoint:T+14h`. **Rename `packages/ledger-signer` → `packages/attest-signer`** (`@xrlp/attest-signer`), delete the hardware-wallet backend (`src/ledger.ts`, `scripts/speculos-smoke.ts`, `scripts/probe-tx-types.ts`, the four `@ledgerhq/*` deps, `TESTING.md` §2–5) and keep `SoftwareSigner`, `buildAttestationTx`, `combineMultisig`, `verifySignedBlob` + their tests. `SoftwareSigner.signAttestation` over memo `{kind:"audit", milestoneId, hash: sha256(audit)}`; POST route 10 with `signedTxBlob`; show the attestation tx + explorer link. Replace the `verdictHash` placeholder with the real audit hash. (Hardware-wallet backend parked.)

### INS-05 · Audit history + "what my audit fed"
`size:S` `demo-critical` `checkpoint:T+14h`. For each submitted audit: the milestone's checks panel outcome (read from route 2), which checks used the audit (`inspector_audit_present`, `audit_matches_evidence`), release tx if any. Makes the inspector's role visible on stage.

### INS-06 · Pre-construction site visit task (project verification escalation)
`size:M` `checkpoint:T+24h`. When `ProjectVerification.needs_human` assigns a pre-visit: a short form (site exists, access, plans match site, notes, photos) → signed attestation → re-runs route 5. Demo uses it only if time; otherwise show the queue entry.

### INS-07 · Re-audit flow after a failed suite
`size:S` `checkpoint:T+24h`. Task `re_audit` with the failed checks listed; new audit supersedes the old one; builder's resubmitted evidence shown.

### INS-08 · Inspector polish
`size:S` `demo-critical` `checkpoint:T+28h`. Projector legibility, one-sentence explainer ("you are the eyes on site; your signed audit is a required check"), keyboard shortcut for submit.

---

## area:core — @seanpatrickmay

### CORE-01 · Contract PR: shared v2 (SoV, audits, verification, states, ports)
`size:M` `demo-critical` `checkpoint:T+1h`. `packages/shared`: `SovLine`, `InspectorAudit`, `ProjectVerification`, `InspectorAssignment`, `Inspector`, `ChecksStatus`, `ReleasePolicy`; `Milestone.status` v2 (`pending|escrowed|evidence_submitted|audited|verified|failed|needs_human|released|expired|refunded`); `Project.status` v2 (`draft|verifying|verified|rejected|terms_locked|funding|funded|escrowed|repaying|completed|stalled`); `ChainEvent.kind` += `verification_fee_paid|project_verified|inspector_assigned|audit_attested|verdict_attested|decision_attested|cover_deposited|credential_accepted|loan_default|release_refused`; `Attestation.role` += `release_service`; `ports.ts` per 05 §3. Reviewed by all four lanes, merged by T+2h.

### CORE-02 · `evaluateRelease()` = the test suite outcome (replaces signer-weight quorum)
`size:S` `demo-critical` `checkpoint:T+6h`. Inputs: `Verdict` (+ policy), audits, attestation tx presence. Outcome `pass | fail | needs_human`; table tests for: all green; one red; missing audit; wrong inspector; low confidence; operator decision. Delete `quorum.ts` weights.

### CORE-03 · Core workflows for every route (fake mode)
`size:L` `demo-critical` `checkpoint:T+6h`. One service method per route 1–23 with state guards + `ErrorCode`s. Fee → verifying → verified (credential on first pass) → lock (assign inspector via verifier) → funding → close (**explicit**, after SubscriptionDate, never auto on deposit) → evidence → audit → run checks → release/fail/needs_human → decision. Stall **per milestone**. Withdraw only in Redemption. Fake ledger simulates the time gates with an injectable clock. E2E fake-mode test = the demo script incl. fraud, missing audit, needs_human, stall, try-steal.

### CORE-04 · Core HTTP server
`size:M` `demo-critical` `checkpoint:T+6h`. Routes 1–23, zod, error envelope, CORS :3000/:3001, multipart (evidence, audit photos) into `DATA_DIR`, `GET /api/files/:id`. HTTP tests on 8 routes.

### CORE-05 · Adapter factory + devnet integration
`size:M` `demo-critical` `checkpoint:T+14h`. `LEDGER_MODE=fake|devnet`, `VERIFIER_MODE=fake|mock|live`, env validated at boot. After each verdict core attests `verdictHash` as `aiAgent`; after each audit (if not client-signed) as the inspector's demo key; after each operator decision as `platform`; before each finish a `release` attestation as `releaseService`. E2E on devnet.

### CORE-06 · Keeper: expire → cancel → refund (idempotent per step)
`size:S` `demo-critical` `checkpoint:T+24h`. Persist after cancel and after LoanPay separately; retry-safe; `KEEPER=1` 30s interval.

### CORE-07 · Demo seed, reset, pre-stage wiring
`size:M` `demo-critical` `checkpoint:T+24h`. Route 21 rebuilds from seed + imports `.data/prestage.json` (Projects A/B/C per XRPL-11). Twice-safe, < 2 min.

### CORE-08 · Store hardening
`size:S` `checkpoint:T+28h`. Unchanged (atomic writes, mutex, dedupe by txHash). Preimage store encrypted at rest with `RELEASE_KEY` env.

### CORE-09 · Root CI + env validation
`size:S` `checkpoint:T+6h`. Unchanged; `.env.example` gains `RELEASE_KEY`, `CORE_URL`, `LEDGER_MODE`, `KEEPER`, `VERIFIER_PROVIDER`.

### CORE-10 · Integration captain: merge train + checkpoint reports
`size:M` `demo-critical` `checkpoint:T+6h`. Unchanged. First job: merge `scaffold/architecture-docs` + PR #75 docs, then CORE-01.

### CORE-11 · E2E rehearsal harness over HTTP
`size:M` `demo-critical` `checkpoint:T+24h`. Unchanged; scenes = `docs/04-demo-script.md` v2.

### CORE-12 · Release service: preimages, conditions, finish, try-steal
`size:M` `demo-critical` `checkpoint:T+14h`. Generates one CSPRNG 32-byte preimage per escrow at close, stores encrypted, hands only conditions to `closeLoanAndCreateEscrows`, rejects duplicates. `release(milestone)`: `evaluateRelease()==pass` → `preflightFinish` (XRPL-14) → `release` attestation → `finishEscrow`. `tryStealDemo()` (route 23) submits a finish with **random** bytes from the platform key, never reads the store. Delete the old `FileInspectorKeyring`. Unit tests + devnet test.

---

## area:pitch

### PITCH-01 · Rubric, deadlines, demo format (@RoroDev2023, T+1h)
Ask organizers: rubric (past events: Innovation · Execution · Impact · Pitch), demo length, submission format. Ask AWS booth whether "verifier runs on Bedrock" qualifies for the Lending slice; ask Quicknode whether a devnet endpoint exists. Log in `docs/decisions.md`.

### PITCH-02 · Demo script v2 (@seanpatrickmay, T+6h) — **done in PR #75**, keep in sync with rehearsals.

### PITCH-03 · Rehearsals + punch list (@seanpatrickmay, T+24h). Unchanged.

### PITCH-04 · Submission package + XRPL primitives appendix (@Jalil-g, T+32h). Add: fee `Payment`, 3 credential types, attestation memos (audit/verdict/release), `tecCRYPTOCONDITION_ERROR` try-steal tx.

### PITCH-05 · Fact-check the problem page (@elmir132, T+14h). Unchanged. Add one source on Schedule of Values / AIA G702-G703 as the draw standard.

### PITCH-06 · Pitch deck + name/copy (@bri-yin, T+24h). From `docs/08-pitch-storyline.md` §2 (8 slides incl. "Who can move the money?" and the GitHub-checks metaphor). Name decided by T+6h.

### PITCH-07 · Judge FAQ (@elmir132, T+24h). From `docs/08-pitch-storyline.md` §5 + `docs/ideas/design-review-2026-10-24.md` §B. Must include: "the AI is your oracle?", "platform holds the release key?", "why not a hardware wallet?", "how do inspectors get hired?", "what about skyscrapers?" (SoV answer).

### PITCH-08 · Backup video (@RoroDev2023, T+28h). ≤3-min recording of the v2 beats; no Ledger clip.

### PITCH-09 · Review `docs/07-pitch.md` v2 + rehearse Q&A (@bri-yin + @Jalil-g, T+14h). 07 was rewritten in PR #75; this ticket is the read-through, timing, and assigning who answers which question.

### DEMO-01 · "Ledger says no" button (@seanpatrickmay route 23 + @bri-yin button, T+24h). See CORE-12 / WEB-11.

---

## Retired tickets (close as not planned, link here)

INS-04 v1 preimage keyring · INS-05 v1 on-ledger condition check · INS-08 v1 XOR split · INS-09 v1 Ledger device (direction: no hardware wallet) ·
XRPL-14 v1 / CORE-12 v1 as filed in #74 (superseded by XRPL-14 v2 + CORE-12 v2 above; keep #74 as the tracking issue for the hole) ·
`docs/06-tickets.md` v1 "If we pivot" section (per-payee escrows stays a roadmap line).

## Load balance (demo-critical count)

| Person | Tickets | ≈ h | Demo-critical |
|---|---|---|---|
| @Jalil-g | XRPL-01..12, 14 (+13 stretch) + PITCH-04/09 | 31 | 12 |
| @elmir132 | VER-01..11, 13 (+12, 14 stretch) + PITCH-05/07 | 30 | 9 |
| @bri-yin | WEB-01..12 + PITCH-06/09 + DEMO-01 button | 31 | 11 |
| @RoroDev2023 | INS-01..08 + PITCH-01/08 | 22 | 6 (lightest lane → first to take S tickets from others after T+14h) |
| @seanpatrickmay | CORE-01..12 + PITCH-02/03 + DEMO-01 route | 32 | 11 |

## Demo-day prep checklist
`demo/reset` ≤30 min before the slot; Project B's escrow already expired; wallets ≥ 20 XRP; verifier cache warm; builder RLUSD trust line
verified; explorer tabs open; both apps + core running; projector 1280×720; backup video open.
