# 06 — Team plan, timeline & tickets (36h)

> **These tickets now live as GitHub Issues #6–#71 (assigned, labelled, linked to epics #1–#5). Issues are the source of truth — edit there, not here.** Each epic has a comment with that person's ordered queue.

Read first: `docs/03-architecture.md`, `docs/xrpl-protocol-notes.md`, `docs/05-api.md`.
The scaffolding agents deliver **foundations only** (`packages/xrpl`, `packages/verifier`, `packages/core` ports/fakes/store,
`apps/web` on mock data, `packages/ledger-signer`). These tickets cover finishing, **integration** (real adapters
replace fakes), hardening, demo polish and the pitch.

Every `### ` block can be pasted 1:1 into a GitHub Issue (title = heading text). IDs are stable, so put them in branch and PR names.
Sizes: **S** ≤ 1.5h · **M** 2–3h · **L** 4–5h (one AI-agent run plus human review). Checkpoint labels match the timeline.

## Owners (disjoint directories, so no merge conflicts)

| Who | Label | Owns (only this person merges changes here) |
|---|---|---|
| **@Jalil-g** | `area:xrpl` | `packages/xrpl/**`: money path, credentials, permissioned domain / private vault, bootstrap, demo script, **`src/adapter.ts` = real `LedgerPort`** |
| **@elmir132** | `area:verifier` | `packages/verifier/**`, `fixtures/**`: AI checks, policy, fixtures, live Claude mode, lien-waiver matching, **`src/adapter.ts` = real `VerifierPort`** |
| **@bri-yin** | `area:web` | `apps/web/**`: marketplace, project detail (the demo screen), invest, builder evidence upload, portfolio, `/demo` control room |
| **@RoroDev2023** | `area:inspector` | `apps/inspector/**` (new app, :3001) and `packages/ledger-signer/**`: queue, review, client-side preimages, attestation signing, release, Ledger device |
| **@seanpatrickmay** | `area:core` | `packages/core/**` (orchestrator, store, HTTP server, adapter wiring), **`packages/shared/**` (all contract changes go through him)**, root config/CI, `docs/05-api.md`, integration + e2e rehearsal |
| everyone | `area:pitch` | `pitch/**`, `docs/**` (one file per topic; 1–2 small tickets each) |

**Contracts between lanes** (changing one = PR reviewed by the producer and every consumer):
`packages/shared` (types + `ports.ts`) and `docs/05-api.md` (HTTP). Cross-area tickets below name the one contract they depend on.

## Timeline (T0 = kickoff)

| When | Checkpoint | Must be true (checked by @seanpatrickmay) |
|---|---|---|
| **T+1h** | De-risk | XRPL-01/02 answered on devnet. CORE-01 contract PR open. PITCH-01 rubric known. |
| **T+6h** | **Integration 0: fake mode** | `pnpm -r typecheck && pnpm -r test` green on `main`. **Both apps click through the full flow against the core HTTP server running on fakes.** Verifier `mock` returns fixture verdicts. |
| **T+14h** | **Integration 1: devnet** | `LEDGER_MODE=devnet`: lock-terms → invest → close → evidence → verify → inspector attest → release, all from the UIs, with explorer links. `VERIFIER_MODE=live` passes VER-10. |
| **T+24h** | Feature complete | Full demo (happy path + fraud hold + stall/refund) runs twice in a row after `demo/reset`. Deck v1. **Rehearsal 1.** No new features after this. |
| **T+28h** | Hardening | Rehearsal-1 punch list fixed. Backup video recorded. **Rehearsal 2.** |
| **T+32h** | **Code freeze** | Only demo-blocking fixes (PR + 1 approval + a rehearsal run). Tag `demo-v1`. |
| **T+33–35h** | Rehearsals 3–4, submit | Demo machine pre-staged (checklist at the bottom). Submitted ≥30 min early. |

Sleep: stagger it. Each person sleeps a ~4h block between T+16h and T+28h, and posts a handoff note first.

## Scope cuts (agreed; don't build these)

- **No Shamir / secret sharing.** The inspector-held unique preimage is the release key; AI and platform approvals are attestations.
- **Credentials and the permissioned domain are set up by script** (XRPL-08). The UIs only show badges.
- **One template in the demo:** `residential_new` with 3 milestones (Foundation, Framing, Roof/Dry-in).
- **No repay UI.** Repay is a `/demo` control-room button.
- No inspector rotation, no share secondary market, no real KYC, no SSE (use polling), no mobile.
- Stretch only: Batch-atomic close (XRPL-13), real Ledger device (INS-09; the software signer is the fallback), lien waivers (VER-12).

## How to run 5 AIs without stepping on each other

1. **One ticket = one branch = one agent run.** Branch `<github-user>/<TICKET-ID>-<slug>`, e.g. `jalil-g/XRPL-06-loan-close`.
   Give each concurrent agent its own git worktree: `git worktree add ../wt-XRPL-06 -b jalil-g/XRPL-06-loan-close`.
2. **Stay in your lane** (Owners table). If you need something in another lane, open an issue labelled with that lane's `area:` plus
   `needs-change`, with the exact interface you want. Never edit another lane's directory, even "just one line".
3. **Contract changes** (`packages/shared/**`, `docs/05-api.md`) are PRs owned by @seanpatrickmay. Consumers review them and rebase within 1h.
   Additive changes only after T+14h.
4. **Lockfile rule:** only the person adding a dependency commits `pnpm-lock.yaml`. On conflict, take `main`'s copy and re-run
   `pnpm install`. PR descriptions must list any new deps. Root `package.json`/CI belong to @seanpatrickmay.
5. **Before every PR:** `pnpm -r typecheck && pnpm -r test` green (CI enforces this after CORE-09), rebased on `main`, ≤ ~400 lines, ticket
   ID in the title, `Closes #<issue>`. Squash-merge. Never force-push `main`.
6. **Devnet isolation:** each developer and agent bootstraps **their own** `WALLETS_FILE` (`.data/wallets.<github-user>.json`).
   Shared accounts cause sequence collisions (`tefPAST_SEQ`). Only the demo machine uses `.data/wallets.demo.json`.
7. **Handoff notes** (your AI hit its usage limit, or you're going to sleep): comment on the Issue using this template. The next person starts by reading it.
   ```
   HANDOFF <TICKET-ID> @ T+<h>
   Branch: <branch> (pushed, last commit <sha>) · typecheck ✔/✘ · tests ✔/✘ (which)
   Done: …   Next step: …   Gotchas: …   Devnet: wallets file, relevant tx hashes
   Paste-able prompt for the next agent: "…"
   ```
8. **Usage.** Lanes are sized to roughly equal hours (table at the bottom). The `L` tickets are the long agentic runs.
   `area:pitch` tickets are light on AI usage, so do them while a long agent run is going. When someone's plan runs out,
   another person takes over an S ticket through its handoff note (assign yourself on the issue). Never take over by force-pushing their branch.
9. **Agent prompt seeds** assume the agent has read `AGENTS.md`, `docs/03-architecture.md`, `docs/xrpl-protocol-notes.md` and
   `docs/05-api.md`. Paste the seed together with the issue body.

---

## area:xrpl — @Jalil-g

### XRPL-01 · Hour-1 spike: multisig-counterparty LoanSet on a closed-ended vault
Labels: `area:xrpl` `size:S` `demo-critical` `checkpoint:T+1h`
Assignee: @Jalil-g · Size: S (1.5h) · Depends on: — · Demo-critical: yes
**Goal:** Prove the riskiest protocol step on devnet before anyone depends on it.
**Acceptance criteria:**
- [ ] `pnpm --filter @xrlp/xrpl spike:loanset` funds fresh accounts and creates an RLUSD issuer, a **closed-ended** vault (`SubscriptionDate=now+90s`, `RedemptionDate=now+1h`), a LoanBroker and a deposit. It waits for Subscription to end, then submits `LoanSet` with platform = `Account` and SPV (master disabled, 3-of-4 SignerList) = `Counterparty`, via `signLoanSetByCounterparty({multisign:true})` + `combineLoanSetCounterpartySigners`. It prints `tesSUCCESS` + an explorer link.
- [ ] It also records the observed result of LoanBrokerSet on an open-ended vault (expected `tecNO_PERMISSION`) and of LoanSet before SubscriptionDate (expected `tecTOO_SOON`).
- [ ] Hashes and codes are appended to `docs/xrpl-protocol-notes.md` §2. If it fails, the documented fallback is chosen in `docs/decisions.md`.

**Files:** `packages/xrpl/scripts/spike-loanset.ts`
**Agent prompt seed:** "Write a standalone xrpl.js 5.3.0 devnet script proving a LoanSet where the borrower (Counterparty) is a master-disabled multisig account, using signLoanSetByCounterparty/combineLoanSetCounterpartySigners on a closed-ended vault (VaultKind=1). Follow docs/xrpl-protocol-notes.md §2–3 exactly; print every tx result + explorer URL."

### XRPL-02 · Hour-1 spike: IOU conditional escrow finish + cancel
Labels: `area:xrpl` `size:S` `demo-critical` `checkpoint:T+1h`
Assignee: @Jalil-g · Size: S (1h) · Depends on: — · Demo-critical: yes
**Goal:** Prove the RLUSD escrow lifecycle with an inspector-style condition.
**Acceptance criteria:**
- [ ] The issuer sets `asfAllowTrustLineLocking`. The SPV multisig sends `EscrowCreate` (Condition+CancelAfter, no FinishAfter).
- [ ] `EscrowFinish` from a **third** account with the fulfillment raises the builder's balance.
- [ ] A second escrow `EscrowCancel`ed after CancelAfter returns funds to the SPV. A builder with no trust line gets `tecNO_LINE`.

**Files:** `packages/xrpl/scripts/spike-escrow.ts`
**Agent prompt seed:** "Devnet script for IOU token escrow (XLS-85) from a multisig SPV with PREIMAGE-SHA-256 (condition A0258020‖sha256(P)‖810120, fulfillment A0228020‖P): third-party finish, cancel after expiry, tecNO_LINE case."

### XRPL-03 · Idempotent bootstrap: wallets, issuer, trust lines, RLUSD
Labels: `area:xrpl` `size:M` `demo-critical` `checkpoint:T+6h`
Assignee: @Jalil-g · Size: M (2.5h) · Depends on: — · Demo-critical: yes
**Goal:** One command creates or refreshes every demo account.
**Acceptance criteria:**
- [ ] `pnpm --filter @xrlp/xrpl bootstrap` (uses `WALLETS_FILE`) funds issuer, platform, trustee, aiAgent, inspector×2, builder and investor×3. It sets issuer `DefaultRipple` **then** `AllowTrustLineLocking` (no TransferRate), opens trust lines, and mints RLUSD to investors, builder and platform.
- [ ] A second run makes no changes. It prints a balance table.

**Files:** `packages/xrpl/src/bootstrap.ts`, `src/wallets.ts`, `src/rlusd.ts`
**Agent prompt seed:** "Make bootstrap idempotent and parameterized by WALLETS_FILE; check on-ledger state (account_info flags, account_lines) before submitting anything. DefaultRipple must come before any trust line."

### XRPL-04 · Closed-ended vault, LoanBroker, first-loss cover
Labels: `area:xrpl` `size:M` `demo-critical` `checkpoint:T+6h`
Assignee: @Jalil-g · Size: M (2.5h) · Depends on: XRPL-01 · Demo-critical: yes
**Goal:** Typed functions for the lender side of a project.
**Acceptance criteria:**
- [ ] `createClosedVault`, `createLoanBroker` and `coverDeposit` match `docs/05-api.md` §3. IDs (`vaultId`, `loanBrokerId`, `shareMptId`) are parsed from metadata.
- [ ] Unit tests on the tx builders cover `VaultKind`, the dates, `AssetsMaximum`, `tfVaultPrivate`/`tfVaultShareNonTransferable`, and the `CoverRate*` pair rule. A devnet smoke test runs behind `XRPL_IT=1`.

**Files:** `packages/xrpl/src/vault.ts`, `src/loan.ts`, `test/*`
**Agent prompt seed:** "Implement createClosedVault/createLoanBroker/coverDeposit per docs/05-api.md §3 and xrpl-protocol-notes §2–3 (CoverRateMinimum=10000, CoverRateLiquidation=100000). Extract object IDs from metadata; unit + opt-in devnet tests."

### XRPL-05 · SPV account + generic multisig submit
Labels: `area:xrpl` `size:M` `demo-critical` `checkpoint:T+6h`
Assignee: @Jalil-g · Size: M (2h) · Depends on: XRPL-03 · Demo-critical: yes
**Goal:** Create the project account and sign anything from it.
**Acceptance criteria:**
- [ ] `createSpv()` does SignerListSet (`platform, builder, inspector, trustee` weight 1 each, quorum 3) and then `asfDisableMaster`.
- [ ] `submitMultisigned(tx, wallets)` autofills with the signer count, signs, combines, submits and waits.
- [ ] A devnet test shows 2 signatures fail and 3 succeed.

**Files:** `packages/xrpl/src/spv.ts`, `src/multisig.ts`
**Agent prompt seed:** "Implement createSpv + submitMultisigned; signer list per docs/03-architecture.md 'SPV signer list'; prove quorum enforcement in a devnet test."

### XRPL-06 · Loan close: countersigned LoanSet + N multisig escrows
Labels: `area:xrpl` `size:L` `demo-critical` `checkpoint:T+14h`
Assignee: @Jalil-g · Size: L (4h) · Depends on: XRPL-01, XRPL-04, XRPL-05 · Demo-critical: yes
**Goal:** One call closes the loan and locks every milestone.
**Acceptance criteria:**
- [ ] `loanSetCountersigned` sets `tfLoanOverpayment`, `PaymentTotal≥2`, `InterestRate>0` and zero late/overpayment fees, and returns `loanId`.
- [ ] `escrowCreateMultisig` runs ×N immediately after (Destination = builder, per-milestone condition + CancelAfter) and returns `offerSequence`s.
- [ ] Throws `TooSoonError` before SubscriptionDate. Checks `maturity+60 ≤ RedemptionDate` and `CancelAfter < maturity` client-side. Rejects duplicate conditions.
- [ ] A devnet test shows the SPV's liquid RLUSD ≈ 0 after close.

**Files:** `packages/xrpl/src/loan.ts`, `src/escrow.ts`
**Agent prompt seed:** "Implement loanSetCountersigned + escrowCreateMultisig per docs/05-api.md §3, reusing the XRPL-01 spike; return everything LedgerPort.closeLoanAndCreateEscrows needs."

### XRPL-07 · Release, cancel, repay, withdraw
Labels: `area:xrpl` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @Jalil-g · Size: M (3h) · Depends on: XRPL-05 · Demo-critical: yes
**Goal:** Every post-close money movement.
**Acceptance criteria:**
- [ ] `escrowFinish` (any submitter, fee raised for the fulfillment), `escrowCancel`, `builderPayToSpv`, `loanPayMultisig({overpayment})` and `vaultWithdraw` work. `tecTOO_SOON` is mapped to `TooSoonError`.
- [ ] A devnet test (short-lived closed-ended vault) runs finish → repay → withdraw after RedemptionDate.

**Files:** `packages/xrpl/src/escrow.ts`, `src/loan.ts`, `src/vault.ts`
**Agent prompt seed:** "Implement escrowFinish/escrowCancel/loanPayMultisig/vaultWithdraw per docs/05-api.md §3 and the stall path in docs/03-architecture.md."

### XRPL-08 · Attestations, credentials, permissioned domain, private vault (+ compliance script)
Labels: `area:xrpl` `size:M` `checkpoint:T+14h`
Assignee: @Jalil-g · Size: M (3h) · Depends on: XRPL-03 · Demo-critical: no (attest is used in the demo; compliance is a judge talking point)
**Goal:** The on-chain audit trail plus the regulatory answer.
**Acceptance criteria:**
- [ ] `attest({signer, memo:{v:1, milestoneId, decision, verdictHash}})` is an AccountSet no-op with a `xrlp/attest` memo. A test round-trips the memo.
- [ ] `issueCredential`, `acceptCredential`, `createDomain` and private-vault creation work.
- [ ] `pnpm --filter @xrlp/xrpl compliance` issues `KYC_INVESTOR` (accepted) to investors 1–2, not to investor3, and `VERIFIED_BUILDER` to the builder. It creates the domain. Investor3's deposit fails with `tecNO_AUTH`, and the log links to it.

**Files:** `packages/xrpl/src/attest.ts`, `src/credentials.ts`, `scripts/compliance.ts`
**Agent prompt seed:** "Implement attest/credentials/domain + scripts/compliance.ts per xrpl-protocol-notes §3 (private vault). The subject must CredentialAccept. Print explorer links."

### XRPL-09 · Read models: vault, loan, escrow snapshots
Labels: `area:xrpl` `size:S` `demo-critical` `checkpoint:T+14h`
Assignee: @Jalil-g · Size: S (1h) · Depends on: XRPL-04 · Demo-critical: yes
**Goal:** Live on-chain truth for the UIs and the keeper.
**Acceptance criteria:**
- [ ] `getVault` returns `VaultSnapshot` (phase from ledger close time, `sharePrice`). `getLoan` returns `LoanSnapshot`. `getEscrow(owner, seq)` returns the escrow or null.
- [ ] The parsers are tested against recorded devnet JSON fixtures.

**Files:** `packages/xrpl/src/read.ts`
**Agent prompt seed:** "Implement getVault/getLoan/getEscrow returning the snapshot shapes in docs/05-api.md §2; record real devnet responses as fixtures."

### XRPL-10 · `XrplLedgerAdapter implements LedgerPort` (replaces the fake)
Labels: `area:xrpl` `integration` `size:L` `demo-critical` `checkpoint:T+14h`
Assignee: @Jalil-g · Size: L (4h) · Depends on: CORE-01 (contract: `packages/shared/src/ports.ts`), XRPL-04..09 · Demo-critical: yes
**Goal:** Core runs on devnet without any change to core code.
**Acceptance criteria:**
- [ ] `packages/xrpl/src/adapter.ts` implements every `LedgerPort` method, including the CORE-01 deltas (closed-ended dates, cover, new reads).
- [ ] Every `ChainEvent` has a valid explorer URL. `XrplTxError` maps to the `ErrorCode`s in `docs/05-api.md` §1.
- [ ] Core's e2e test passes with `LEDGER_MODE=devnet` (opt-in, long timeout).

**Files:** `packages/xrpl/src/adapter.ts`, `test/adapter.it.ts`
**Agent prompt seed:** "Implement XrplLedgerAdapter in packages/xrpl/src/adapter.ts against the LedgerPort interface in packages/shared/src/ports.ts, using only this package's functions. Run core's e2e with LEDGER_MODE=devnet."

### XRPL-11 · End-to-end devnet demo script + pre-staging
Labels: `area:xrpl` `size:L` `demo-critical` `checkpoint:T+24h`
Assignee: @Jalil-g · Size: L (4h) · Depends on: XRPL-06, XRPL-07 · Demo-critical: yes
**Goal:** A CLI version of the whole demo (also the backup), plus pre-staged ledger state.
**Acceptance criteria:**
- [ ] `pnpm --filter @xrlp/xrpl demo` runs: bootstrap → vault (≈2 min Subscription, countdown) → 3 deposits → close → release M1 → M2 stays locked → M3 cancel → LoanPay refund → repay. One explorer link per tx. Under 6 min. Resumable.
- [ ] `--prestage` produces three projects: one past SubscriptionDate (ready to close), one stalled with an escrow expiring ≈2 min after staging, and one past RedemptionDate (withdraw-able). It writes their IDs to `.data/prestage.json` for CORE-07.

**Files:** `packages/xrpl/scripts/demo.ts`
**Agent prompt seed:** "Write scripts/demo.ts orchestrating the full flow in docs/04-demo-script.md with packages/xrpl functions only; add --prestage producing the three lifecycle states in the ticket."

### XRPL-12 · Submission hardening and error mapping
Labels: `area:xrpl` `size:S` `demo-critical` `checkpoint:T+28h`
Assignee: @Jalil-g · Size: S (1.5h) · Depends on: XRPL-05 · Demo-critical: yes
**Goal:** No flaky tx on stage.
**Acceptance criteria:**
- [ ] Every submit sets `LastLedgerSequence` and retries `terQUEUED`/`tefPAST_SEQ`/`telINSUF_FEE_P` up to 3×. A per-account mutex serializes sequences. Non-`tesSUCCESS` throws `XrplTxError{result,hash}`.
- [ ] 20 parallel deposits finish with no sequence errors.

**Files:** `packages/xrpl/src/client.ts`
**Agent prompt seed:** "Harden submission in packages/xrpl: per-account mutex, LastLedgerSequence, bounded retries, typed XrplTxError; public signatures unchanged."

### XRPL-13 · (Stretch) Atomic close via Batch
Labels: `area:xrpl` `size:M` `stretch`
Assignee: @Jalil-g · Size: M (2.5h) · Depends on: XRPL-06 · Demo-critical: no
**Goal:** `LoanSet + EscrowCreate×N` in one `ALLORNOTHING` Batch, so the SPV never holds liquid principal.
**Acceptance criteria:**
- [ ] A devnet test with N=3 passes (multisig SPV + platform as BatchSigners). On failure it falls back to XRPL-06.

**Files:** `packages/xrpl/src/batch-close.ts`
**Agent prompt seed:** "Using XLS-56 (BatchV1_1 on devnet) and xrpl.js Batch, wrap LoanSet (inner, Counterparty=platform) + EscrowCreates in one ALLORNOTHING Batch with multisig BatchSigners."

---

## area:verifier — @elmir132

### VER-01 · Demo evidence fixtures with ground truth (incl. sourcing)
Labels: `area:verifier` `size:M` `demo-critical` `checkpoint:T+6h`
Assignee: @elmir132 · Size: M (3h) · Depends on: — · Demo-critical: yes
**Goal:** Deterministic, realistic inputs for the demo and the evals.
**Acceptance criteria:**
- [ ] `fixtures/evidence/maple-st/{foundation,framing,dry_in}/` contains photos (EXIF GPS inside the site geofence, timestamps after escrow creation), invoice PDFs matching the template budget lines, and a footing-inspection doc.
- [ ] `framing/` includes one photo reused from `foundation/` with an older EXIF date.
- [ ] `manifest.json` gives the expected decision and failing checks per milestone. Photo sources and licenses are listed in `fixtures/SOURCES.txt`. Total < 15 MB.

**Files:** `fixtures/evidence/**`
**Agent prompt seed:** "Create the Maple St evidence fixtures + manifest; set DateTimeOriginal/GPS with exiftool or piexif; generate invoice PDFs matching packages/shared residential_new budget shares."

### VER-02 · Evidence preprocessing: EXIF, sha256, perceptual hash
Labels: `area:verifier` `size:M` `demo-critical` `checkpoint:T+6h`
Assignee: @elmir132 · Size: M (2.5h) · Depends on: VER-01 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `preprocess(evidence[])` fills `meta.takenAt/gps/perceptualHash` and verifies `sha256`. It handles JPEG and PNG, and HEIC is either handled or rejected with a reason.
- [ ] Tests show the reused photo's pHash distance ≤ 6 from its original.

**Files:** `packages/verifier/src/meta.ts`
**Agent prompt seed:** "Implement preprocess() with pure-JS libs (exifr + jimp/sharp pHash); tests against fixtures/evidence."

### VER-03 · Deterministic checks (the fraud catcher)
Labels: `area:verifier` `size:M` `demo-critical` `checkpoint:T+6h`
Assignee: @elmir132 · Size: M (3h) · Depends on: VER-02 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `gps_within_site`, `photo_fresh` (takenAt > escrowCreatedAt), `no_duplicate_photo` (pHash vs priorEvidence), `required_evidence_present` and `invoice_total_present` each return a `CheckResult` with a human-readable reason and evidenceIds.
- [ ] The framing fixture fails `no_duplicate_photo` and `photo_fresh`, with reasons like "IMG_2231 matches foundation photo IMG_1180 (taken 41 days earlier)".

**Files:** `packages/verifier/src/checks.ts`
**Agent prompt seed:** "Implement the deterministic checks against VerifyMilestoneInput (packages/shared/src/ports.ts after CORE-01). Reasons must read well on a projector."

### VER-04 · Live Claude vision check: stage consistency
Labels: `area:verifier` `size:L` `demo-critical` `checkpoint:T+14h`
Assignee: @elmir132 · Size: L (4h) · Depends on: VER-02 · Demo-critical: yes
**Acceptance criteria:**
- [ ] With `VERIFIER_MODE=live`, the Anthropic SDK is called with the images and the template `visualCriteria`. Output is structured (zod-validated `stage_visually_consistent` result + reason + confidence).
- [ ] An on-disk cache keyed by input hash makes the demo repeatable. Timeouts and errors give `needs_human`, never `pass`.

**Files:** `packages/verifier/src/llm/*`
**Agent prompt seed:** "Implement the live vision check with the Anthropic SDK (model = VERIFIER_MODEL), zod-validated JSON output, sha256-keyed disk cache, fail-closed."

### VER-05 · Invoice extraction + budget match
Labels: `area:verifier` `size:M` `checkpoint:T+14h`
Assignee: @elmir132 · Size: M (2.5h) · Depends on: VER-01 · Demo-critical: no
**Acceptance criteria:**
- [ ] Extracts `{vendor, date, total}` (live: Claude; mock: manifest). `invoice_matches_budget` passes within ±10%, warns within ±25%, and fails otherwise. All three bands are tested.

**Files:** `packages/verifier/src/invoice.ts`
**Agent prompt seed:** "Implement invoice extraction + invoice_matches_budget; mock reads totals from the fixture manifest; live uses Claude with a zod schema."

### VER-06 · Policy engine (risk tier × project type)
Labels: `area:verifier` `size:S` `checkpoint:T+6h`
Assignee: @elmir132 · Size: S (1.5h) · Depends on: — · Demo-critical: no
**Acceptance criteria:**
- [ ] `policyFor()` is pure and covered by a table test. Amount ≥ `TWO_INSPECTOR_THRESHOLD` or `riskTier=high` → 2 inspectors. `minConfidence` is 0.7/0.8/0.9 by tier. Hard-fail and soft checks are listed.

**Files:** `packages/verifier/src/policy.ts`
**Agent prompt seed:** "Implement policyFor() per VerifierPort with an exhaustive table-driven test."

### VER-07 · Verdict assembly + canonical verdict hash
Labels: `area:verifier` `size:S` `demo-critical` `checkpoint:T+6h`
Assignee: @elmir132 · Size: S (1.5h) · Depends on: VER-03, VER-06 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Combines checks + policy into `decision/confidence/summary` (any hard fail → `fail`; low confidence → `needs_human`). `summary` is one sentence a judge understands.
- [ ] `verdictHash(v)` = sha256 of canonical JSON (sorted keys), exported for core and the inspector app. Snapshot tests.

**Files:** `packages/verifier/src/verifyMilestone.ts`, `src/hash.ts`
**Agent prompt seed:** "Assemble Verdict from CheckResults + policy; export verdictHash via canonical JSON."

### VER-08 · Builder onboarding verification
Labels: `area:verifier` `size:M` `checkpoint:T+14h`
Assignee: @elmir132 · Size: M (2h) · Depends on: — · Demo-critical: no
**Acceptance criteria:**
- [ ] `verifyBuilder()` checks mock registry JSON (license active, insurance unexpired, name match) and returns reasons (each labelled MOCK) and `riskTier`. Fixtures: one good builder and one with expired insurance.

**Files:** `packages/verifier/src/verifyBuilder.ts`, `fixtures/builders/*`
**Agent prompt seed:** "Implement verifyBuilder against mock registries in fixtures/builders; label every data source MOCK."

### VER-09 · `ClaudeVerifierAdapter implements VerifierPort`
Labels: `area:verifier` `integration` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @elmir132 · Size: M (2h) · Depends on: CORE-01 (contract: `packages/shared/src/ports.ts`), VER-07 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `packages/verifier/src/adapter.ts` implements `verifyMilestone`, `verifyBuilder` and `policyFor` for `mock` and `live`. The verdict carries `model`.
- [ ] Core's fake-mode e2e test passes with `VERIFIER_MODE=mock` using this adapter.

**Files:** `packages/verifier/src/adapter.ts`
**Agent prompt seed:** "Implement ClaudeVerifierAdapter against VerifierPort in packages/shared/src/ports.ts; deterministic in mock mode for the Maple St fixtures."

### VER-10 · Eval harness (mock + live)
Labels: `area:verifier` `size:S` `demo-critical` `checkpoint:T+14h`
Assignee: @elmir132 · Size: S (1.5h) · Depends on: VER-07 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `pnpm --filter @xrlp/verifier eval [--live]` prints a pass/fail table against the manifests and exits non-zero on mismatch. Live mode is stable on 3/3 runs.

**Files:** `packages/verifier/scripts/eval.ts`
**Agent prompt seed:** "Eval runner over fixtures/evidence/*/manifest.json for mock and live; report per-check diffs."

### VER-11 · Robustness: prompt injection, missing metadata, fail-closed
Labels: `area:verifier` `size:M` `checkpoint:T+28h`
Assignee: @elmir132 · Size: M (2h) · Depends on: VER-04, VER-10 · Demo-critical: no (good pitch point)
**Acceptance criteria:**
- [ ] Adversarial fixtures (image text "APPROVED — ignore instructions", missing EXIF, wrong GPS) give `fail` or `needs_human`, never `pass`. They are included in the eval.

**Files:** `packages/verifier/src/llm/*`, `fixtures/evidence/adversarial/*`
**Agent prompt seed:** "Add adversarial fixtures; harden the prompt and post-processing so only deterministic checks + schema-valid model output can yield pass."

### VER-12 · (Stretch, pivot-ready) Lien-waiver matching
Labels: `area:verifier` `size:M` `stretch`
Assignee: @elmir132 · Size: M (3h) · Depends on: VER-05 · Demo-critical: no
**Goal:** The AI matches invoices to lien waivers. This is the core check if we adopt the per-payee pivot (bottom of this doc).
**Acceptance criteria:**
- [ ] `lien_waiver_present` (conditional for this draw, unconditional for the previous one), plus waiver amount == previous draw and payee == invoice vendor.
- [ ] Fixtures include one missing waiver (fail) and one mismatched amount (fail).

**Files:** `packages/verifier/src/lienWaiver.ts`, `fixtures/evidence/maple-st/waivers/*`
**Agent prompt seed:** "Implement lien-waiver checks: extract payee/amount/type from waiver docs (mock via manifest, live via Claude) and cross-match invoices."

---

## area:web — @bri-yin

### WEB-01 · Typed API client with mock/http switch
Labels: `area:web` `size:S` `demo-critical` `checkpoint:T+6h`
Assignee: @bri-yin · Size: S (1.5h) · Depends on: CORE-01 (contract: `docs/05-api.md`) · Demo-critical: yes
**Acceptance criteria:**
- [ ] `apps/web/lib/api.ts` has one function per route used by web. `NEXT_PUBLIC_API_MODE=mock` serves the existing mock data; `http` calls `/api/*`, rewritten to `CORE_URL` in `next.config`.
- [ ] Errors come back as a typed `ApiError{code}`. Typecheck passes against `@xrlp/shared`.

**Files:** `apps/web/lib/api.ts`, `apps/web/next.config.ts`
**Agent prompt seed:** "Implement apps/web/lib/api.ts per docs/05-api.md §2 with a mock/http switch and a Next rewrite to CORE_URL; move existing mocks behind it."

### WEB-02 · Marketplace
Labels: `area:web` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @bri-yin · Size: M (2.5h) · Depends on: WEB-01 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Project cards show funding bar, builder `VERIFIED_BUILDER` badge, deadline countdown (SubscriptionDate), principal and rate. Filter by project type. Polls every 5s.

**Files:** `apps/web/app/(investor)/page.tsx`, `components/project-card.tsx`
**Agent prompt seed:** "Build the marketplace from ProjectSummary (docs/05-api.md); projector-friendly; reuse the existing UI kit; no new deps without a PR note."

### WEB-03 · Project detail = the demo screen
Labels: `area:web` `size:L` `demo-critical` `checkpoint:T+14h`
Assignee: @bri-yin · Size: L (4h) · Depends on: WEB-01, WEB-04, WEB-05 · Demo-critical: yes
**Goal:** One screen the presenter can stay on for the whole demo.
**Acceptance criteria:**
- [ ] Shows terms, vault panel (phase subscription/investment/redemption, share price, AssetsAvailable, "redeem opens <date>"), loan panel, and milestone rail (status chips; verdict card inline; attestation list with who/when/tx).
- [ ] Includes the timeline and money map. Polls every 3s. A state change appears within 5s of the tx.

**Files:** `apps/web/app/projects/[id]/**`
**Agent prompt seed:** "Build the project detail page from ProjectDetail; it is the live demo screen, so it must read from 5m away and update within 5s of on-chain changes."

### WEB-04 · Verdict card
Labels: `area:web` `size:M` `demo-critical` `checkpoint:T+6h`
Assignee: @bri-yin · Size: M (2.5h) · Depends on: — (shared `Verdict` type) · Demo-critical: yes
**Acceptance criteria:**
- [ ] Decision banner, confidence, one row per check (icon, reason, evidence thumbnails), and the attestation tx link.
- [ ] `/dev/verdicts` renders the pass fixture and the duplicate-photo fail fixture.

**Files:** `apps/web/components/verdict-card.tsx`, `app/dev/verdicts/page.tsx`
**Agent prompt seed:** "Build VerdictCard for the shared Verdict type plus a /dev/verdicts showcase (pass + duplicate-photo fail)."

### WEB-05 · Audit timeline + money map
Labels: `area:web` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @bri-yin · Size: M (3h) · Depends on: WEB-01 · Demo-critical: yes
**Acceptance criteria:**
- [ ] The timeline lists `ChainEvent`s with actor role, amount and explorer link.
- [ ] The money map shows Vault → SPV → escrows (locked/released/refunded) → builder with amounts and animates transitions subtly.

**Files:** `apps/web/components/timeline.tsx`, `components/money-map.tsx`
**Agent prompt seed:** "Build the audit timeline + money map from ChainEvent[] and ProjectDetail."

### WEB-06 · Invest flow
Labels: `area:web` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @bri-yin · Size: M (2.5h) · Depends on: WEB-03 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Demo-investor picker + amount → route 5, followed by a TxToast with an explorer link. Disabled after SubscriptionDate, with an explanation. A KYC badge is shown. A non-KYC investor sees the domain-rejection message.

**Files:** `apps/web/app/projects/[id]/invest/**`, `components/tx-toast.tsx`
**Agent prompt seed:** "Implement the invest flow (route 5) with a reusable TxToast (hash → explorer link) and friendly too_soon/not-KYC errors."

### WEB-07 · Investor portfolio
Labels: `area:web` `size:M` `checkpoint:T+24h`
Assignee: @bri-yin · Size: M (2h) · Depends on: WEB-01 · Demo-critical: no
**Acceptance criteria:**
- [ ] `/portfolio/[investor]` lists positions (route 22): shares, value, phase, redemption date. A Withdraw button (route 14) is enabled only in Redemption.

**Files:** `apps/web/app/portfolio/**`
**Agent prompt seed:** "Build the portfolio page from PortfolioPosition[]; withdraw only in redemption phase."

### WEB-08 · Builder onboarding page
Labels: `area:web` `size:M` `checkpoint:T+14h`
Assignee: @bri-yin · Size: M (2h) · Depends on: WEB-01 · Demo-critical: no
**Acceptance criteria:**
- [ ] Pick or upload mock docs → route 17. Reasons appear as a checklist, then a `VERIFIED_BUILDER` badge with a credential tx link.

**Files:** `apps/web/app/builder/onboarding/**`
**Agent prompt seed:** "Builder onboarding page using route 17; render BuilderVerification reasons as a checklist with MOCK labels."

### WEB-09 · Create project from template
Labels: `area:web` `size:M` `checkpoint:T+14h`
Assignee: @bri-yin · Size: M (2.5h) · Depends on: WEB-01 · Demo-critical: no
**Acceptance criteria:**
- [ ] Template select + principal → auto-split milestones (amounts editable, evidence requirements read-only). Inspectors are shown. Shares must sum to 100%. Submits route 3.

**Files:** `apps/web/app/builder/projects/new/**`
**Agent prompt seed:** "Create-project form from MILESTONE_TEMPLATES; evidence requirements are read-only (that's the product point)."

### WEB-10 · Builder milestone evidence upload
Labels: `area:web` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @bri-yin · Size: M (3h) · Depends on: WEB-01, WEB-04 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Drag-drop photos and invoices plus a one-click "load Maple St fixture" → route 8. Thumbnails show EXIF date/GPS. "Run AI check" → route 9 → VerdictCard.

**Files:** `apps/web/app/builder/projects/[id]/milestones/[mid]/**`
**Agent prompt seed:** "Evidence upload + run-verification page with a fixture quick-pick for the live demo."

### WEB-11 · `/demo` control room
Labels: `area:web` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @bri-yin · Size: M (2.5h) · Depends on: WEB-01 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Buttons for lock terms (4), close loan (7; SubscriptionDate countdown, disabled until then), keeper tick (20), builder repay (13; this replaces a repay UI), demo reset (19), and "open inspector app".
- [ ] Each button shows its events. A scene list mirrors `docs/04-demo-script.md`.

**Files:** `apps/web/app/demo/**`
**Agent prompt seed:** "Build /demo: one button per route 4/7/13/19/20, a SubscriptionDate countdown, and a scene checklist from docs/04-demo-script.md."

### WEB-12 · Projector polish + empty/error states
Labels: `area:web` `size:S` `demo-critical` `checkpoint:T+28h`
Assignee: @bri-yin · Size: S (1.5h) · Depends on: WEB-02..11 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Legible at 1280×720. Every page has loading, empty and error states. Every `ErrorCode` has friendly copy (`too_soon` → "Funding window still open"). Lighthouse a11y ≥ 90.

**Files:** `apps/web/**`
**Agent prompt seed:** "Polish pass: projector legibility, loading/empty/error states, human copy for ApiError codes in docs/05-api.md §1."

---

## area:inspector — @RoroDev2023

### INS-01 · Scaffold `apps/inspector` + API client
Labels: `area:inspector` `size:S` `demo-critical` `checkpoint:T+6h`
Assignee: @RoroDev2023 · Size: S (1.5h) · Depends on: CORE-01 (contract: `docs/05-api.md`) · Demo-critical: yes
**Acceptance criteria:**
- [ ] A new Next.js app at `apps/inspector` (`@xrlp/inspector`, port 3001) with `pnpm --filter @xrlp/inspector dev`.
- [ ] `lib/api.ts` covers routes 2, 6, 10, 11, 21 with a mock/http switch and a rewrite to `CORE_URL`.
- [ ] Inspector identity picker (inspector A/B from the demo wallets). Typecheck passes.

**Files:** `apps/inspector/**`
**Agent prompt seed:** "Scaffold apps/inspector (Next App Router, TS strict, same UI kit as apps/web but no imports from it) with a typed API client per docs/05-api.md."

### INS-02 · Inspector queue
Labels: `area:inspector` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @RoroDev2023 · Size: M (2.5h) · Depends on: INS-01 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `/` lists `InspectorTask`s (route 21) grouped by `needs` (condition / review / release), with project, milestone, amount and AI decision badge. Polls every 5s.

**Files:** `apps/inspector/app/page.tsx`
**Agent prompt seed:** "Build the inspector queue from InspectorTask[] (docs/05-api.md)."

### INS-03 · Milestone review screen
Labels: `area:inspector` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @RoroDev2023 · Size: M (3h) · Depends on: INS-02 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Evidence gallery (from `/api/files/:id`) with EXIF time/GPS, a site map pin vs the photo pins, the AI verdict (same layout as web's card, implemented locally), and prior attestations with tx links.

**Files:** `apps/inspector/app/milestones/[mid]/**`
**Agent prompt seed:** "Build the review screen: evidence gallery with EXIF, a site-vs-photo map, verdict and attestation history."

### INS-04 · Preimage keyring (the release key)
Labels: `area:inspector` `size:L` `demo-critical` `checkpoint:T+14h`
Assignee: @RoroDev2023 · Size: L (4h) · Depends on: INS-01 · Demo-critical: yes
**Goal:** The inspector's browser alone holds each milestone's fulfillment.
**Acceptance criteria:**
- [ ] For each assigned milestone needing a condition: a 32-byte `crypto.getRandomValues` preimage is stored in IndexedDB (keyed by project+milestone), and **only** the condition is posted (route 6).
- [ ] Never reuses a preimage. Unit tests produce conditions byte-identical to `packages/core/src/conditions.ts`.
- [ ] Encrypted backup export/import (passphrase, AES-GCM). Clearing site data and restoring from backup recovers the release key.

**Files:** `apps/inspector/lib/keyring.ts`, `app/keys/**`
**Agent prompt seed:** "Implement a WebCrypto keyring per docs/03-architecture.md 'Escrow gating': fresh preimage per escrow, condition = A0258020‖sha256(P)‖810120, fulfillment = A0228020‖P, IndexedDB storage, passphrase-encrypted backup. The fulfillment never leaves the browser before approval."

### INS-05 · On-ledger condition check
Labels: `area:inspector` `size:S` `demo-critical` `checkpoint:T+14h`
Assignee: @RoroDev2023 · Size: S (1.5h) · Depends on: INS-04 · Demo-critical: yes
**Acceptance criteria:**
- [ ] After close, the app reads the escrow directly from devnet (`account_objects`/`ledger_entry` via public JSON-RPC, not through core) and shows "on-chain condition matches your key ✔/✘", with an explorer link.

**Files:** `apps/inspector/lib/ledger-check.ts`
**Agent prompt seed:** "Read the SPV's escrow from devnet JSON-RPC in the browser and compare its Condition to the keyring's condition; independent of core on purpose."

### INS-06 · Attestation signing via `packages/ledger-signer`
Labels: `area:inspector` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @RoroDev2023 · Size: M (2.5h) · Depends on: INS-01, XRPL-08 (contract: memo format `xrlp/attest` v1 in `packages/xrpl/src/attest.ts`) · Demo-critical: yes
**Acceptance criteria:**
- [ ] `ledger-signer` exposes `signAttestation({milestoneId, decision, verdictHash, notes}) → signedTxBlob` with a software backend (demo seed in local storage).
- [ ] The inspector app posts `signedTxBlob` to route 10. The tx shows up on the explorer with a decodable memo.

**Files:** `packages/ledger-signer/src/{software,attestation}.ts`, `apps/inspector/lib/sign.ts`
**Agent prompt seed:** "Implement software-backend attestation signing in packages/ledger-signer (AccountSet no-op + memo per XRPL-08 format) and wire it into the inspector app."

### INS-07 · Approve → reveal → release; reject; override rule
Labels: `area:inspector` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @RoroDev2023 · Size: M (3h) · Depends on: INS-03, INS-04, INS-06 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Approve: sign the attestation, then send the fulfillment to route 11, then show the released state + tx link.
- [ ] Reject: an attestation with notes; the fulfillment is kept.
- [ ] If the AI verdict isn't `pass`, approve requires an override reason, which is included in the attestation memo.
- [ ] A 2-inspector milestone stays locked until both have approved.

**Files:** `apps/inspector/app/milestones/[mid]/actions.tsx`
**Agent prompt seed:** "Implement approve/reject/override per the release policy in docs/05-api.md §3 item 5; the fulfillment is revealed only on approve."

### INS-08 · Two-inspector XOR split
Labels: `area:inspector` `size:M` `checkpoint:T+24h`
Assignee: @RoroDev2023 · Size: M (2.5h) · Depends on: INS-04 · Demo-critical: no
**Acceptance criteria:**
- [ ] For `requiredInspectors=2`, inspector A generates `a` and `b` with `P = a XOR b`. It exports `b` encrypted for inspector B (copy/paste or QR), then deletes `b`. The release combines both shares. The trust note is shown in the UI.

**Files:** `apps/inspector/lib/split.ts`
**Agent prompt seed:** "Implement a 2-of-2 XOR preimage split between two inspector browsers per docs/03-architecture.md; delete the dealer's copy of b after export."

### INS-09 · Ledger-device signing (Speculos / WebHID) — Ledger bounty
Labels: `area:inspector` `size:L` `bounty:ledger` `checkpoint:T+24h`
Assignee: @RoroDev2023 · Size: L (5h) · Depends on: INS-06 · Demo-critical: no (bounty)
**Acceptance criteria:**
- [ ] The `ledger-signer` Ledger backend (`@ledgerhq/hw-app-xrp` over WebHID; Speculos for dev) signs the attestation tx, and the device screen shows the memo/amount. It falls back to software.
- [ ] A 20-second video clip for the pitch.

**Files:** `packages/ledger-signer/src/ledger.ts`
**Agent prompt seed:** "Add a Ledger backend to packages/ledger-signer (hw-app-xrp via WebHID; Speculos for CI/dev) behind the same signAttestation interface; document the setup in the PR."

### INS-10 · Inspector polish
Labels: `area:inspector` `size:S` `checkpoint:T+28h`
Assignee: @RoroDev2023 · Size: S (1.5h) · Depends on: INS-02..07 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Projector legibility, loading/error states, a clear "you hold the release key" explainer, and a keyboard shortcut for approve in the demo.

**Files:** `apps/inspector/**`
**Agent prompt seed:** "Polish the inspector app for the stage; explain the release key in one sentence."

---

## area:core — @seanpatrickmay

### CORE-01 · Contract PR: shared deltas + move ports to shared
Labels: `area:core` `contract` `size:S` `demo-critical` `checkpoint:T+1h`
Assignee: @seanpatrickmay · Size: S (2h) · Depends on: — · Demo-critical: yes
**Acceptance criteria:**
- [ ] `packages/shared/src/ports.ts` holds `LedgerPort`/`VerifierPort` (moved from core, with the `docs/05-api.md` §3 deltas).
- [ ] Shared types get: `ChainEvent` kinds `cover_deposited|credential_accepted|loan_default`, `LoanTerms.paymentTotal`, `Project.chain` dates/cover, `Milestone.inspector`, `InspectorTask`, `PortfolioPosition`, `VaultSnapshot`, `LoanSnapshot`.
- [ ] Reviewed by @Jalil-g, @elmir132, @bri-yin and @RoroDev2023. Merged by T+2h.

**Files:** `packages/shared/src/*`, `packages/core/src/ports.ts` (re-export)
**Agent prompt seed:** "Move core's ports into packages/shared/src/ports.ts and apply the deltas in docs/05-api.md §3; additive, tested, no other packages touched."

### CORE-02 · Release policy replaces the signer-weight quorum
Labels: `area:core` `size:S` `demo-critical` `checkpoint:T+6h`
Assignee: @seanpatrickmay · Size: S (1.5h) · Depends on: CORE-01 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `evaluateRelease()`: required inspectors approved, fulfillment matches the stored condition, and an AI `pass` or an inspector `override` exists. Platform approval is recorded. Table tests. Old weights removed.

**Files:** `packages/core/src/release-policy.ts`
**Agent prompt seed:** "Replace signer-weight quorum with the release policy in docs/05-api.md §3 item 5; table-driven tests."

### CORE-03 · Core workflows for every route (fake mode)
Labels: `area:core` `size:L` `demo-critical` `checkpoint:T+6h`
Assignee: @seanpatrickmay · Size: L (4h) · Depends on: CORE-01, CORE-02 · Demo-critical: yes
**Acceptance criteria:**
- [ ] One service method per route in `docs/05-api.md` §2 with state-machine guards and typed `ErrorCode`s. `registerCondition` rejects malformed or duplicate conditions.
- [ ] The fake ledger simulates the Subscription/Redemption gates with an injectable clock. An e2e test (fake mode) runs the whole demo, including fraud and stall.

**Files:** `packages/core/src/**`
**Agent prompt seed:** "Implement core service methods for docs/05-api.md §2 on fakes incl. closed-ended timing gates and duplicate-condition rejection; one e2e test = the demo script."

### CORE-04 · Core HTTP server
Labels: `area:core` `size:M` `demo-critical` `checkpoint:T+6h`
Assignee: @seanpatrickmay · Size: M (3h) · Depends on: CORE-03 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `pnpm --filter @xrlp/core serve` serves routes 1–22 on :4000, with zod input validation, the error envelope, CORS for :3000/:3001, multipart evidence into `DATA_DIR`, and `GET /api/files/:id`.
- [ ] HTTP tests cover 6 routes. Both apps work against it with `NEXT_PUBLIC_API_MODE=http`.

**Files:** `packages/core/src/http/**`
**Agent prompt seed:** "Add a small HTTP server (node:http or Hono, note the dep in the PR) exposing docs/05-api.md §2; thin handlers over the core service."

### CORE-05 · Adapter factory + devnet integration
Labels: `area:core` `integration` `size:M` `demo-critical` `checkpoint:T+14h`
Assignee: @seanpatrickmay · Size: M (3h) · Depends on: XRPL-10, VER-09 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `factory.ts` picks fakes or `XrplLedgerAdapter`/`ClaudeVerifierAdapter` from env and validates env at boot.
- [ ] The e2e test passes with `LEDGER_MODE=devnet VERIFIER_MODE=mock`. After each verdict, core submits the aiAgent attestation with `verdictHash`.

**Files:** `packages/core/src/factory.ts`, `test/e2e.devnet.test.ts`
**Agent prompt seed:** "Wire the real adapters from packages/xrpl and packages/verifier into core's factory; run the e2e on devnet; core logic must not change."

### CORE-06 · Keeper: expire → cancel → refund
Labels: `area:core` `size:S` `demo-critical` `checkpoint:T+24h`
Assignee: @seanpatrickmay · Size: S (1.5h) · Depends on: CORE-05 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `keeperTick()` finds escrows past CancelAfter, then runs `EscrowCancel` → `LoanPay(overpayment)` and moves the milestone `expired → refunded`. Idempotent. Optional `KEEPER=1` 30s interval.

**Files:** `packages/core/src/keeper.ts`
**Agent prompt seed:** "Idempotent keeperTick() per the stall path in docs/03-architecture.md; unit tests with a controllable clock."

### CORE-07 · Demo seed, reset, pre-stage wiring
Labels: `area:core` `size:M` `demo-critical` `checkpoint:T+24h`
Assignee: @seanpatrickmay · Size: M (3h) · Depends on: CORE-05, XRPL-11 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Route 19 rebuilds the store from seed JSON and, on devnet, imports `.data/prestage.json` (three lifecycle states). Running it twice is safe and takes under 2 min.

**Files:** `packages/core/src/demo-seed.ts`, `packages/core/seed/maple-st.json`
**Agent prompt seed:** "Implement resetDemo() importing XRPL-11 prestage output so the live demo never waits on ledger time gates."

### CORE-08 · Store hardening
Labels: `area:core` `size:S` `checkpoint:T+28h`
Assignee: @seanpatrickmay · Size: S (1.5h) · Depends on: CORE-03 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Atomic writes (tmp+rename), an in-process mutex, and ChainEvent dedupe by txHash. A crash-safety test shows the previous state survives a kill mid-write.

**Files:** `packages/core/src/file-store.ts`
**Agent prompt seed:** "Harden the JSON store: atomic rename, mutex, txHash dedupe, crash-safety test."

### CORE-09 · Root CI + env validation
Labels: `area:core` `infra` `size:S` `checkpoint:T+6h`
Assignee: @seanpatrickmay · Size: S (1.5h) · Depends on: — · Demo-critical: no
**Acceptance criteria:**
- [ ] A GitHub Actions workflow runs `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r test` on PRs (no devnet, no API keys).
- [ ] `.env.example` covers every var (`CORE_URL`, `LEDGER_MODE`, `KEEPER`, …). Branch protection on `main` is requested.

**Files:** `.github/workflows/ci.yml`, `.env.example`, root `package.json`
**Agent prompt seed:** "Add CI running typecheck + tests for the pnpm workspace; no secrets; cache the pnpm store."

### CORE-10 · Integration captain: merge train + checkpoint reports
Labels: `area:core` `integration` `size:M` `demo-critical` `checkpoint:T+6h`
Assignee: @seanpatrickmay · Size: M (3h, spread out) · Depends on: — · Demo-critical: yes
**Acceptance criteria:**
- [ ] At T+6h, T+14h and T+24h, post a checkpoint report as a comment on a pinned "Checkpoints" issue: what runs end to end, what's red, the owners of blockers. Contract-change PRs are reviewed within 30 min.

**Files:** none (Issues)
**Agent prompt seed:** "Given the merged PR list and test output, write a checkpoint report against the timeline in docs/06-tickets.md and list blockers by owner."

### CORE-11 · E2E rehearsal harness over HTTP
Labels: `area:core` `size:M` `demo-critical` `checkpoint:T+24h`
Assignee: @seanpatrickmay · Size: M (2.5h) · Depends on: CORE-04, CORE-07 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `pnpm --filter @xrlp/core rehearse` drives the full demo through HTTP (fake or devnet), checks each scene's expected state, prints timings per scene, and exits non-zero on drift.

**Files:** `packages/core/scripts/rehearse.ts`
**Agent prompt seed:** "Write an HTTP-level rehearsal runner mirroring docs/04-demo-script.md scenes with assertions and timings."

---

## area:pitch — spread across everyone (light AI usage)

### PITCH-01 · Rubric, deadlines, demo format
Labels: `area:pitch` `size:S` `checkpoint:T+1h`
Assignee: @RoroDev2023 · Size: S (1h) · Depends on: — · Demo-critical: yes
**Acceptance criteria:**
- [ ] Rubric, submission deadline, demo length, required artifacts and bounty rules (Ledger, RLUSD/XRPL tracks) recorded in `docs/decisions.md`. Affected tickets are flagged in chat.

**Agent prompt seed:** "Summarize the pasted rubric/bounty rules into docs/decisions.md and map each criterion to tickets in docs/06-tickets.md."

### PITCH-02 · Demo script v2 (protocol-accurate)
Labels: `area:pitch` `size:S` `demo-critical` `checkpoint:T+6h`
Assignee: @seanpatrickmay · Size: S (1.5h) · Depends on: PITCH-01 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `docs/04-demo-script.md` covers: pre-staged closed-ended timing, share value rising **at close**, stall = cancel → SPV → LoanPay → redeem at RedemptionDate, and the inspector holding the release key. Each scene lists page, action, tx and line. Fits the rubric length.

**Agent prompt seed:** "Rewrite docs/04-demo-script.md from docs/xrpl-protocol-notes.md §3 and 03 'Stall path'; per scene: page, action, tx kind, spoken line."

### PITCH-03 · Rehearsals + punch list
Labels: `area:pitch` `size:S` `demo-critical` `checkpoint:T+24h`
Assignee: @seanpatrickmay · Size: S (1.5h) · Depends on: PITCH-02, CORE-11 · Demo-critical: yes
**Acceptance criteria:**
- [ ] Timed rehearsals at T+24h, T+28h and T+33h. Each failure becomes an issue labelled `punch` with an owner. The final run is under the limit with zero manual fixes.

**Agent prompt seed:** "Turn these rehearsal notes into punch-list issues with owner, repro, acceptance."

### PITCH-04 · Submission package + XRPL primitives appendix
Labels: `area:pitch` `size:S` `demo-critical` `checkpoint:T+32h`
Assignee: @Jalil-g · Size: S (1.5h) · Depends on: PITCH-06 · Demo-critical: yes
**Acceptance criteria:**
- [ ] `pitch/submission.md` has the submission text, repo, video link, team roles, and every XRPL primitive used (Vault, LoanBroker/cover, LoanSet countersign, token escrow, multisig, credentials, domain) with one real devnet explorer link each. Submitted ≥30 min early.

**Agent prompt seed:** "Draft pitch/submission.md from the deck + docs; list every XRPL primitive with one explorer link from .data/demo-state.json."

### PITCH-05 · Fact-check the problem page
Labels: `area:pitch` `size:S` `checkpoint:T+14h`
Assignee: @elmir132 · Size: S (1h) · Depends on: — · Demo-critical: no
**Acceptance criteria:**
- [ ] Every claim in `docs/01-problem.md` has a working link or **(unverified)**. Draw-software vendors are checked. One on-site builder/lender quote is added if obtainable.

**Agent prompt seed:** "Fact-check docs/01-problem.md link by link; fix or mark (unverified)."

### PITCH-06 · Pitch deck + name/copy
Labels: `area:pitch` `size:M` `demo-critical` `checkpoint:T+24h`
Assignee: @bri-yin · Size: M (2h) · Depends on: PITCH-02 · Demo-critical: yes
**Acceptance criteria:**
- [ ] About 8 slides: problem (sourced), solution, live-demo cue, **"Who can move the money?"** (escrow destination fixed; inspector = release key; 3-of-4 SPV; collusion bound; first-loss cover), XRPL primitives, what's next (Smart Escrows XLS-100, per-payee/lien waivers), honest caveats.
- [ ] The product name and hero copy are decided and logged in `docs/decisions.md`.

**Agent prompt seed:** "Draft an 8-slide outline + speaker notes from docs/01–03 and xrpl-protocol-notes; include the 'Who can move the money?' table."

### PITCH-07 · Judge FAQ (trust model + AI)
Labels: `area:pitch` `size:S` `checkpoint:T+24h`
Assignee: @elmir132 · Size: S (1h) · Depends on: — · Demo-critical: no
**Acceptance criteria:**
- [ ] `pitch/faq.md` answers, in ≤3 sentences each with a spec/tx reference: can the platform steal? inspector collusion? what does the AI actually check (and not)? why XRPL? is this a security? what happens on default?

**Agent prompt seed:** "Write a judge FAQ grounded only in docs/03 and xrpl-protocol-notes; flag anything not enforced on-chain."

### PITCH-08 · Backup video + Ledger clip
Labels: `area:pitch` `size:S` `demo-critical` `checkpoint:T+28h`
Assignee: @RoroDev2023 · Size: S (1.5h) · Depends on: CORE-07 · Demo-critical: yes
**Acceptance criteria:**
- [ ] A ≤3-min screen recording of the full demo, explorer screenshots per tx, and the INS-09 Ledger clip if available. Stored offline on the presenter laptop, with a link posted in chat.

**Agent prompt seed:** "Make a shot list for the backup recording from docs/04-demo-script.md with exact clicks and waits."

---

## Load balance (sum of sizes, stretch excluded)

| Person | Lane tickets | Pitch | Total ≈ h | Demo-critical |
|---|---|---|---|---|
| @Jalil-g | XRPL-01..12 (+13 stretch) | PITCH-04 | 30 + 1.5 = **31.5** | 11 |
| @elmir132 | VER-01..11 (+12 stretch) | PITCH-05, PITCH-07 | 25.5 + 2 = **27.5** (+3 stretch = 30.5) | 7 |
| @bri-yin | WEB-01..12 | PITCH-06 | 29.5 + 2 = **31.5** | 9 |
| @RoroDev2023 | INS-01..10 | PITCH-01, PITCH-08 | 27 + 2.5 = **29.5** | 8 |
| @seanpatrickmay | CORE-01..11 | PITCH-02, PITCH-03 | 26.5 + 3 = **29.5** (+ reviews/integration) | 10 |

**Ticket count:** 13 xrpl · 12 verifier · 12 web · 10 inspector · 11 core · 8 pitch = **66**.

## Demo-day prep checklist (@seanpatrickmay + @RoroDev2023)

- [ ] `demo/reset` run on the demo machine ≤30 min before the slot. The ready-to-close project is past SubscriptionDate, and the stall escrow expires about 2 min into the demo.
- [ ] Demo wallets each ≥ 20 XRP (faucet = 100/call). Verifier live cache warm. Inspector keyring restored on the demo laptop. Backup video open.
- [ ] Explorer tabs pre-opened. Both apps and core running. Projector resolution tested.

## If we pivot (per-payee escrows + institutional lender) — not adopted, impact only

The idea: each milestone pays the builder **and** its subcontractors directly through per-payee escrows, the AI matches invoices to
lien waivers, and the lender is an institutional/private-credit fund instead of retail investors.

| Ticket | Change if adopted |
|---|---|
| CORE-01 | `Milestone.payees: {address, role, amount, lienWaiverRequired}[]`; `Milestone.escrows[]` (one per payee) |
| XRPL-06 / XRPL-10 | N milestones × M payees escrows (0.2 XRP reserve each, still small). Subcontractors need RLUSD trust lines at onboarding. Batch (XRPL-13) stops being useful above 7 escrows |
| INS-04 / INS-07 | **One preimage per milestone, shared by all of that milestone's payee escrows**, so one reveal releases every payee together. The uniqueness rule becomes "unique per milestone", which is intentional here |
| VER-12 → demo-critical | Lien-waiver matching becomes the headline AI check. VER-05 adds `invoice_matches_payee` |
| VER-01 | Waiver PDFs per subcontractor; a missing-waiver fraud case replaces or adds to the reused photo |
| WEB-02 / WEB-06 / WEB-07 | Retail marketplace becomes a lender dashboard (one depositor, private vault, KYB credential). "Invest" becomes "fund facility" |
| WEB-09 / WEB-10 | Payee table in project creation; waiver upload per payee |
| XRPL-08 | Credentials `ACCREDITED_LENDER` / `SUBCONTRACTOR`; the domain admits the lender only |
| PITCH-05/06/07 | Story shifts from retail transparency to lien-safe draws + an audit trail for lenders; needs mechanics-lien evidence |
| Unchanged | XRPL-01..05, 07, 09, 11, 12 · VER-02..04, 06, 07, 09..11 · INS-01..03, 05, 06, 08..10 · CORE-02..11 |
