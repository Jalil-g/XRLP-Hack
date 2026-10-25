# Decisions log

## Shared frontend polish — 2026-10-25

- User authorized a consistent Apple/Notion-style polish of both `apps/web` and `apps/inspector`. Both consume `apps/styles/drawproof.css`; inspector compatibility aliases preserve existing component APIs. No domain contracts or signing algorithms change.
- Match the white canvas, system type, restrained blue actions, status labels, solid header, account menu, responsive gutters, focus states, and reduced motion. App-specific data access stays separate.
- Require a review before deposits, other payments, audit signatures, and site-visit signatures. Evidence uploads use a short choose/review/submit sequence. Preserve drafts on Back, prevent repeated submission, and retain inspector evidence-version validation.
- The demo control room follows the primary 100-second recording story. Ledger-condition rejection and stall/refund tools remain available under an extended walkthrough disclosure, outside the timed pitch.

## Adopted presentation decision — 2026-10-25

User confirmed one three-minute total slot, Apple/Notion simplicity, guided flows with review before signing/paying, and a prerecorded demo. The authoritative plan is [08-pitch-storyline.md](08-pitch-storyline.md): six slides, 8/22/15/15/100/10 seconds, 170 seconds content plus 10 seconds reserve. The demo shows one release and one failed hold. Slide 3 states AI/inspector/XRPL responsibilities; slide 6 closes with fees, one construction-lending pilot ask, and thanks.

Use [deck guide](ideas/pitch-3min-style-guide.md), [Claude PowerPoint prompts](ideas/pitch-3min-claude-prompts.md), [recording script](04-demo-script.md), and [shared frontend direction](ideas/shared-frontend-style.md). Finished deck/video remain to be produced. Historical entries below retain their context; old eight-slide numbering, live-stage beats, and the 3:00 + 2:00 assumption are superseded.


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
- [10-24] **Preimages are held by core's release service** (unique per escrow, encrypted at rest), disclosed on slide 3 and in Q&A. Ledger enforces
  destination + expiry; the suite + on-chain attestations make release timing auditable. Smart Escrows (XLS-100) = roadmap. (Jalil)
- [10-24] **Per-project verification fee** paid by the builder in RLUSD on-chain; AI-first verification of builder identity, project feasibility
  and builder capability; inspectors only when the AI escalates (`needs_human` → pre-construction site visit). `VERIFIED_BUILDER` on first pass. (Jalil)
- [10-24] **Schedule of Values** (AIA G702/G703) defines milestones for any project size; residential templates are pre-filled SoVs. Demo = Maple St. (Jalil)
- [10-24] **Inspector assignment fully automated by AI** from a verified panel (`VERIFIED_INSPECTOR`), at lock-terms. Roadmap: robots/sensors through the same signed-audit interface. (Jalil)
- [10-24] **No hardware-wallet (Ledger device) work.** Software inspector key; `packages/ledger-signer` keeps the interface (→ renamed `packages/attest-signer`, device code removed, INS-04). (Jalil)
- [10-24] Sponsor stance: Lending & Borrowing track; AWS only as Bedrock provider swap if confirmed at booth; no Quicknode (no devnet), no Mastercard AP4M. (Jalil)
- [10-24] Marketplace framing kept: KYC'd investors choose verified projects; institutional lender = same rail, one depositor. (Jalil)
- [10-24] **Name: Drawproof.** (Jalil)
- [10-24] **Verification fee: 250 RLUSD in the demo.** In the product the fee **scales with project size** (e.g. bps of principal with a floor); the UI and the business slide must say so. (Jalil)
- [10-24] Tickets v2 in `docs/06-tickets.md`; GitHub issues synced. Retired: INS-04/05/08/09 v1. New: XRPL-14, VER-13, VER-14, INS-06/07 v2, CORE-12, DEMO-01, PITCH-09.
- [10-24] XRPL-01 proven with the v2 SPV list (3-of-4 counterparty countersign incl. platform as both Account and signer); no master-key fallback needed. Spikes use fresh throwaway faucet wallets (`scripts/spike-lib.ts`), not the bootstrap store. (Jalil's agent)
- [10-24] XRPL-04 fee/cover defaults: `CoverRateMinimum 10000` / `CoverRateLiquidation 100000` always on `LoanBrokerSet`; `ManagementFeeRate 10000` (10% of interest, protocol max, matches the pitch's "~10% of interest"); `LoanOriginationFee` 150 bps (1.5%, low end of the pitch's 1.5-2%); cover deposit default `max(10% of principal, ceil((principal + interest) x 10%) + 10% headroom)` — a flat 10% of principal is always *below* the protocol minimum once interest > 0. — all named constants + options in `src/lending-math.ts` (Jalil's agent, XRPL-04)
- [10-24] Origination fee is "points paid at closing": `LoanSet` sends `principal - fee` to the SPV, but milestone escrows sum to the full principal (core enforces it), so `closeLoanAndCreateEscrows` has the builder (`originationFeePayer`) pay the shortfall into the SPV right before `LoanSet`, failing fast if the builder lacks RLUSD. **Bootstrap must fund the builder** (≥ fee + verification fee). Alternative (milestones sum to `principal - fee`) is a core/product call. (Jalil's agent, XRPL-04)
- [10-24] `preflightFinish` defaults: margin = max(120s, LastLedgerSequence offset 20 × 5s/ledger) to `CancelAfter`, all reads pinned to one validated ledger; refuses on **any** freeze, missing/insufficient trust-line headroom, RequireAuth, DepositAuth, or a condition/fulfillment that doesn't match the **on-ledger** Condition. `finishEscrow` preflights by default (`skipPreflight` opt-out) and uses preflight's Fee/LLS — a failed finish leaks the preimage, so false refusals are the cheaper error. (Jalil's agent, XRPL-14)
- [10-24] Attestations (`xrlp/attest/v1`) stay a 1-drop XRP Payment attester → project SPV with one JSON memo; `submitSignedBlob` only accepts exactly that shape (single-signed, 1 drop, one valid memo, valid signature). One PermissionedDomain per platform (AcceptedCredentials = [platform, KYC_INVESTOR]) shared by all private vaults; `grantCredential`/`createDomain` are idempotent. `release` attestations map to `approval_attested` until shared gets a dedicated kind; v2 event kinds are cast until #53 merges. (Jalil's agent, XRPL-08)
- [10-24] Submissions lock per account through validation, always set LastLedgerSequence (margin 20, `XRPL_LLS_MARGIN`), and retry only transient results. A new blob is signed only once the old one provably can't apply (same Sequence re-sign; fresh Sequence only on tefPAST_SEQ for a never-sent blob). Throughput is ~1 tx/ledger per account, which is fine for the demo. Why: 20 parallel raw submits gave 19× tefPAST_SEQ on devnet. (Jalil's agent, XRPL-12)
- [10-24] XRPL-02 proven on devnet with the v2 SPV: multisig IOU EscrowCreate, finish by a separate releaseService, `tecCRYPTOCONDITION_ERROR` / `tecNO_LINE` / `tecNO_PERMISSION` all on-ledger; a failed finish publishes the fulfillment, so preflight (XRPL-14) is mandatory before any fulfillment is signed (Jalil's agent, XRPL-02)
- [10-24] **Share value rises as interest is repaid, not at LoanSet** — devnet (rippled 3.4.1) leaves `Vault.AssetsTotal` at principal after LoanSet and adds interest on LoanPay (XRPL-04, XRPL-09 evidence). Demo/pitch/UI copy changed from "booked at close" to "rises as interest is repaid". (Jalil's agent)
- [10-24] Bootstrap roles v2: `issuer, platform, releaseService, builder, investor1..3, inspector1..3, aiAgent, trustee`. RLUSD trust lines only for holders (`platform, builder, investor1..3`); signer-only roles (releaseService, trustee, inspectors, aiAgent) get none. Mint: investors 50k, platform 25k (cover for several prestaged projects), builder 1k (≥ 250 fee). v1 `inspectorA/B` renamed to `inspector1/2` (same account), unknown roles kept under `retired`. Until XRPL-05, SPV list stays v1-shaped with inspector1/2 in the inspector slots and default signers platform + inspector1 (builder isn't on that list yet). (Jalil's agent, XRPL-03)
- [10-24] SPV default multisig quorum = platform + builder + trustee (any 3 of 4 is valid). These are fixed per project whichever inspector the AI assigned; callers pass the inspector explicitly when it should sign. `submitMultisigned` checks quorum against the on-ledger SignerList before submitting, because xrpl.js `submitAndWait` hangs ~1 min on `tef*` instead of throwing (Jalil's agent, XRPL-05)

- [10-24] Read models (XRPL-09): `VaultSnapshot`/`LoanSnapshot` defined locally in `packages/xrpl/src/reads.ts` (not in shared yet); `sharesOutstanding` = raw share-MPT units, `sharePrice` = RLUSD per whole share (10^Scale units), 6 dp; RLUSD reads truncate (never round up); paid-off loan → `nextPaymentDueDate: ""`; open-ended vault → phase `subscription` — keeps the 05-api shape without a contract change (Jalil's agent, XRPL-09)
- [10-25] xrpl: `UnsafeReleaseError` now extends the shared `LedgerError` (code `unsafe_release`) and `toLedgerError(e)` maps XrplTxError tecTOO_SOON → `TooSoonError`, other tx failures → `LedgerError("ledger_error")` with txResult/txHash; release attest memos keep `approval_attested` (shared v2 has no release kind); `toChainEvent` sets `result` only for non-tesSUCCESS — so the LedgerPort adapter throws/emits exactly the shared contract (Jalil's agent, shared-v2 align)

- [10-25] Bootstrap grants the demo credentials idempotently (KYC_INVESTOR investor1/2, VERIFIED_INSPECTOR inspector1..3; VERIFIED_BUILDER only with `preVerifyBuilder`) and **deletes** a stray KYC_INVESTOR from investor3 (`NO_KYC_ROLES`), since the tecNO_AUTH beat needs investor3 uncredentialed; `issueCredential` delegates to `grantCredential` (deprecated); platform RLUSD default stays 25 000 (= cover for 3 concurrent ~68k projects), sized with `platformRlusdFor`; `submitMultisigned` goes through `submitWithSigner` so SPV multisig txs hold the per-SPV lock (Jalil's agent, hardening)

- [10-25] `closeLoanAndCreateEscrows` validates everything before the first tx (`planLoanClose`): `PaymentTotal ≥ 2`, `0 < InterestRate ≤ 100%`, `PaymentInterval ≥ 60s`, loan fits `RedemptionDate`, 32-byte PREIMAGE-SHA-256 conditions only (`A0258020…810120`), unique within the call **and vs the SPV's open escrows** (doubles as a re-run guard), `now + 60s < CancelAfter < maturity` with maturity = ledger now + interval × total (a lower bound of the real one), SPV signer quorum. Failure after LoanSet → `CloseLoanPartialError {loanId, created, pending}`. — never leave principal liquid in the SPV because escrow #2 was bad (Jalil's agent, XRPL-06)
- [10-25] Default escrow `CancelAfter` = **maturity − one payment interval** (was now + termDays, which equals maturity and would now be rejected) — a refunded escrow still lands in time to pay the last installment. Callers (core, demo, prestage) should pass `cancelAfters` explicitly. (Jalil's agent, XRPL-06)
- [10-25] `generateMilestoneCondition` dropped from the public API (only a `@deprecated` re-export so `scripts/demo.ts` compiles); tests/spikes use `packages/xrpl/test/support/conditions.ts`. Remove the deprecated export once demo.ts and the G-owned spikes switch. (Jalil's agent, XRPL-06)
- [10-25] Batch atomic close: devnet rippled 3.4.1 rejects LoanSet (all Lending/SAV types) as a Batch inner tx with `temINVALID_INNER_BATCH` until `LendingProtocolV1_2`. So `closeLoanAtomic` defaults to mode "escrows": countersigned LoanSet, then one `tfAllOrNothing` Batch of every milestone EscrowCreate from the SPV (2 txs, SPV liquid ~2 ledgers). Mode "full" (platform outer, LoanSet + escrows, SPV BatchSigner) is implemented and offline-tested for when V1_2 lands. Not wired into `closeLoanAndCreateEscrows` yet (api.ts owned elsewhere). See protocol-notes §2d (Jalil's agent, XRPL-13)
- [10-25] XRPL-07 money-out defaults: finish/cancel submitted by `releaseService`; EscrowFinish LLS margin 60 ledgers, so preflight wants ≥ 300 s to CancelAfter (real escrows are days away; spikes pass `lastLedgerMargin: 20`); `repayLoan` auto-mode = `late` if past due, `overpayment` only for `source: "escrow_refund"` above one periodic payment, else `regular` (builder repayments never silently prepay principal); amounts are checked client-side (≥ one periodic payment rounded up, ≤ total outstanding) → `LoanPayAmountError` code `validation`, nothing submitted; cancel/withdraw timing is checked against validated-ledger close time → shared `TooSoonError` before submitting; `builderPayToSpv` returns no ChainEvent until shared has a kind for it; the wrong-fulfillment demo refuses a missing/expired escrow so a demo click can't waste the beat on `tecNO_PERMISSION` — why: a failed finish leaks the preimage and a rejected LoanPay/withdraw costs a demo minute, so refuse early with a typed error (Jalil's agent, XRPL-07)
- [10-25] **Escrows are created atomically in the main close path.** `closeLoanAndCreateEscrows` defaults to `escrowMode: "batch"` for 2..8 milestones: countersigned LoanSet, then ONE `tfAllOrNothing` Batch of every EscrowCreate via `createEscrowsAtomic` (`escrows[i].createTx` = the inner tx, `batchTx` = the outer); 1 or 9+ milestones (XLS-56 limit) stay sequential, and `"sequential"` stays selectable. Every escrow passes `planLoanClose`, then `validateEscrowSpecs` right before signing (also in `createEscrowsAtomic` / `closeLoanAtomic`, the latter before its LoanSet). A Batch is judged by its inner txs looked up in its own ledger (`ParentBatchID` + `searched_all`), never by the outer result (always `tesSUCCESS`): a rollback → `CloseLoanPartialError` with every milestone pending. Validation through the last escrow holds the SPV submit lock (in-process re-run guard). — why: one all-or-nothing step instead of N keeps the SPV liquid ≤ 2 ledgers and makes "some escrows exist" impossible (Jalil's agent, XRPL-13b)
- [10-25] **Partial-close recovery = `resumeEscrowCreation(err | {project, loanId, created, pending, conditions, cancelAfters})`.** Idempotent by re-reading the SPV first: open escrows matched by condition, plus EscrowCreates in its `account_tx`; an escrow whose condition was used and is gone (finished/cancelled) is never re-created, since a published fulfillment would pay twice. It waits out a tx whose outcome was unknown (until its LastLedgerSequence), and checks the Loan (borrower = SPV; the real maturity bounds new CancelAfters) and the SPV's RLUSD before any submit. Core/the adapter can call it on `CloseLoanPartialError`; no contract change (Jalil's agent, XRPL-13b)
- [10-25] `generateMilestoneCondition` has one user left (today's `scripts/demo.ts`; the XRPL-11 rewrite doesn't use it): delete the deprecated export once XRPL-11 merges. Spikes, tests and fixture capture use `test/support/conditions.ts` (Jalil's agent, XRPL-13b)
- [10-25] Merged `main` @ e67052a verified on devnet end-to-end (bootstrap ×2 idempotent, demo, 5 spikes, compliance, stress, withdraw) — all green, proof in `docs/proof-devnet-2026-10-25-v2.md`. Gaps: demo still uses v1 `attestApproval`; `setupProjectOnChain` creates public vaults (no DomainID); `finishEscrow` always uses the 120 s preflight margin; submit lock ≈ 6.6 s/tx/account (Jalil's agent, devnet verification)
- [10-25] `XrplLedgerAdapter` (shared `LedgerPort`, `packages/xrpl/src/adapter.ts`): phase gates are **pre-checked on ledger time** (close before SubscriptionDate, withdraw before RedemptionDate, cancel before CancelAfter → `TooSoonError`, nothing submitted, no fee burnt); `not_found`/`validation` ride on `XrplLedgerError.apiCode` because shared `LedgerError.code` only has 3 values (asked on #53); SPV multisig signers are chosen from the **on-ledger SignerList** among keys in the wallet store (builder/platform/trustee first); vaults are private (platform KYC_INVESTOR domain) with non-transferable shares; `issueCredential` returns `[]` when already accepted. On merge with XRPL-06/07 (M3 integration): close inputs are validated only by `planLoanClose` (the adapter's own copy was dropped), repay mode/amount only by `planLoanPayment` (checked before the builder's Payment, so a refused LoanPay never strands it), error mapping is built on errors.ts `toLedgerError`/`toErrorCode` (`toAdapterError`; `CloseValidationError`/`LoanPayAmountError` → `validation`, `CloseLoanPartialError` passes through as `ledger_error`), and `preflightFinish` uses the same LLS margin as `finishEscrow` (60 ledgers, ≥ 300 s before CancelAfter; `finishMargins` option) so a preflight ok is not refused by the finish (Jalil's agent, XRPL-10)
- [10-25] Loan default (`src/default.ts`): `defaultLoan` / `impairLoan` / `unimpairLoan` = `LoanManage` by the platform (broker owner). A pure guard (`checkLoanManage`) mirrors rippled 3.4.1's checks in its order, and it runs on one validated ledger under the platform account lock, so nothing is submitted that the ledger would refuse. Devnet has fixCleanup3_4_0, so both boundaries are exclusive: default only when ledger time > `NextPaymentDueDate + GracePeriod`, impair only when > `NextPaymentDueDate`. A timing refusal throws `LoanManageTooSoonError`, a shared `TooSoonError` that adds `allowedAfter` for the keeper's retry; anything else throws `LoanManageRefusedError` (`ledger_error`). `defaultLoan` is idempotent: on an already-defaulted loan it returns the original tx via `Loan.PreviousTxnID` and submits nothing. The `loan_default` amount is DefaultAmount. Impair/unimpair emit **no** ChainEvent: shared has no impairment kind, and `loan_default` would claim a default that hasn't happened (`loan_impaired` proposed on #53, with `LedgerPort.defaultLoan`). (Jalil's agent, XRPL-15)
- [10-25] Devnet vaults are **cash basis** (`Vault.LEVersion 1`, LendingProtocolV1_1; the patch is reserved as XLS-66.1.1 and unpublished). A default writes off `PrincipalOutstanding` only, `DebtTotal` is principal only, and with our 10% / 100% rates **DefaultCovered = 10% of DebtTotal at default time**. Devnet run: 1000 defaulted, cover returned 100 (= `expectedDefaultCovered`), vault loss 900, share price 1 → 0.1; the leftover cover (10.000043) stays with the platform. With 600 repaid first: 400.00019 defaulted, cover 40.000019025767 (rounded up at LoanScale, = expected), share price 1 → 0.64. The stall path holds: refunds are repaid first, then the cover pays, then investors absorb the rest. Note that repaying first also shrinks the cover the default can draw. Protocol-notes §3c (Jalil's agent, XRPL-15)
- [10-25] **xrpl security review** (`docs/reviews/xrpl-security-review-2026-10-25.md`), calls made while fixing it: (1) the retry
  engine tracks every blob of an intent that may have reached a server and settles them before a fresh-Sequence re-sign or
  any give-up; `retriable: true` now strictly means "nothing can still apply", an unknown outcome is non-retriable
  `connection_lost` / `unknown_outcome`. (2) `finishEscrow` signs one blob per preflight and submits it pre-signed (never
  re-signed by the engine); `unsafe_release` from a finish means the fulfillment never left the process, a refusal after a
  submit is `preflight_refused_after_submit`. (3) Mainnet guard = URL/label denylist + `server_info.network_id === 2` on
  connect (`XRPL_NETWORK_ID` for another custom net, never 0/1). (4) Adapter keys are bound to roles per input
  (`SIGNING_ROLES`); aiAgent / releaseService / issuer can't be SPV signers. (5) Before LoanSet the escrow destination must
  exist, be on the SPV's signer list and not be another role's key; the multisig path refuses an SPV whose master key is
  still enabled. (6) `resumeEscrowCreation({ project, ... })` requires `builderAddress` and waits one LLS margin by default.
  (7) In-repo `WALLETS_FILE` / `DATA_DIR` must be git-ignored; the wallet store is written atomically, 0600. (8) Validation
  errors never echo a would-be condition. Deferred with reasons in the review doc; core items in the linked issue. (Jalil's agent, security review)
- [10-25] **Pipelined submission (XRPL-17) is opt-in**: `XRPL_PIPELINE=1` or `setSubmitMode("pipelined", { window })`, window 5 (max 10 = rippled's per-account TxQ cap); the default stays XRPL-12's lock-through-validation. Pipelined, the account lock covers only autofill → sign → submit, `Sequence` comes from a local counter (advanced only when the server took the blob), and up to 5 txs per account wait for validation together. `tefPAST_SEQ` / `terPRE_SEQ` / a tx that died unapplied → stop issuing, let every in-flight tx settle, re-read the Sequence, re-sign only the provably dead txs (never one that may still apply); tec/tem are never retried. **"Dead" is proven from account state** (Sequence at the LastLedgerSequence ledger ≤ S, or `account_tx` shows another tx used S), not from `tx` + `searched_all`: devnet answers `validated: false` forever for a blob it has seen (protocol notes §0a). A `tel*` blob counts as sent, because rippled may hold and retry it. Explicit `withAccountLock` sections, `submitBlob` (pre-signed), Batch and own-`Sequence` txs keep locked semantics (they first wait for the window to drain), so loan.ts / batch.ts / api.ts did not change. Devnet: 20 Payments from one account ~108 s locked → 22–27 s pipelined (3.9–5.0×, 6–7 consecutive ledgers); multisig, a foreign writer stealing a Sequence, and a held blob proven dead are each 20/20 or 1/1. Prestage and the CLI demo don't get faster: each step awaits the previous one, and ~1 ledger per tx is validation (`prestage --only A`: 123 s locked, 123 s pipelined, 132 s locked). So it pays off for concurrent same-account submits (core serving several platform-signed requests), and flipping it on is core's call. Why opt-in: a new concurrency engine should not silently change the demo path. **Open (locked mode, unchanged here):** `submitReliably` still proves death via `searched_all`, so it can wait forever on a seen-but-never-validated blob, and it doesn't track `tel*` blobs; same fix as the pipelined engine, see #166 (Jalil's agent, XRPL-17)

## Inspector presentation controls (INS-08)

- Projector mode is opt-in and session-local: larger text and stronger secondary
  contrast, without changing API mode, identity, or audit data. The header wraps
  to keep its identity picker and presentation control usable on narrow screens.
- Ctrl/Cmd+Enter activates the existing audit submit button, including all normal
  validation and signing checks. Repeated/composing/handled keys are ignored,
  disabled buttons remain disabled, and an in-flight ref prevents duplicate filing.

## Inspector lane (Roro's agent, challenge freely)

- [10-24] `apps/inspector` uses the `@xrlp/shared` v2 schemas; only the read models shared defines as TS interfaces (`ProjectDetail`,
  `InspectorTask`, snapshots) get local zod schemas in `lib/types.ts`, typed against those interfaces so drift fails typecheck.
- [10-24] Inspector app data access is **client-side** (polling, in-browser signing later); in http mode the browser calls same-origin
  `/api/*` and `next.config.ts` rewrites to `CORE_URL`. Responses are checked against the schemas and drift is logged, not thrown.
- [10-24] Mock-mode parties use **real classic addresses** derived from public entropy `sha256("drawproof/mock/<label>")[0..16]`
  (never funded, not devnet wallets) so INS-04 can sign as a mock inspector without committing any seed.
- [10-24] Route 10 multipart fields `report` / `photos` (repeated) / `signedTxBlob` — same as core's CORE-04 handler.
- [10-25] INS-02 queue evidence status uses the verifier's `required_evidence_present` rule (per kind, bar = largest `minCount`, not the
  sum), so the queue never shows red where the suite passes.
- [10-25] INS-03 `evidenceBundleHash` = the verifier's (`sha256` of sorted per-file `sha256` joined by `"\n"`) over **all** the milestone's
  builder evidence; golden-tested against the verifier's Maple St fixture. Mock route 10 rejects a mismatched bundle up front.
- [10-25] Inspector app adds `exifr` (same parser + options as the verifier; the `lite` build, because the full one probes for Node `fs`/`zlib`
  in the Next bundle), so the photo preview shows exactly the EXIF time/GPS the suite reads.
- [10-25] Inspector mock Maple St moved to the verifier's site (41 Maple St, Brooklyn, 40.6795/-73.962, r=120 m) — the demo photos are
  geotagged there. **Open:** core's demo scenario still puts Maple St in Beacon, NY (41.5048/-73.9696); with the verifier's photos that
  fails `gps_within_site`. Core + verifier should agree on one site.
- [10-25] **Inspector audit attestation = the XRPL-08 Payment format** (Roro): 1-drop Payment inspector → project SPV, one memo
  `xrlp/attest/v1` `{v:1, kind:"audit", milestoneId, hash}`, signed in the inspector app (`@xrlp/attest-signer`) and sent as route 10
  `signedTxBlob`. The v1 `AccountSet` / `xrlp/attestation/v1` builder is gone. Test: an app-signed blob passes packages/xrpl
  `verifyAttestBlob`; devnet smoke (`pnpm --filter @xrlp/attest-signer smoke:devnet`) tesSUCCESS.
- [10-25] Audit memo `hash` = `auditHash(audit)`: sha256 of canonical JSON (keys sorted, no whitespace) of
  `{v:1, milestoneId, inspector, evidenceBundleHash, checklist (sorted by sovCode; note trimmed, omitted if empty), notes (trimmed),
  photos: sorted sha256 of the uploaded files}` — only what core receives and keeps from route 10, none of what core assigns
  (`txHash`, `at`, photo ids). Proposed on #53 for core to recompute and compare.
- [10-25] Inspector keys: mock mode signs with ed25519 keys from **public** entropy `sha256("drawproof/mock/inspector-<name>")[0..16]`
  (worthless by design). http mode: the inspector pastes their devnet seed once; it stays in that browser's localStorage, only the signed
  blob leaves. No key → the audit is filed unsigned and core signs with the demo key (05-api §1), labelled as such in the UI.
  Seeds are never put in `NEXT_PUBLIC_*` env (they would ship in the JS bundle). Autofill uses `XRPL_WS_URL`, `LastLedgerSequence` +75.
- [10-25] `@xrlp/attest-signer` tests run with `node --import tsx` (like core/verifier) because the parity test imports `@xrlp/xrpl`.
- [10-25] Submission package `docs/submission/` cites only tx hashes already published in our docs or PR bodies: the v2 proof (#126) first,
  then Batch from protocol-notes §2d / §2e, LoanManage from §3c, the CLI demo's batch close from `packages/xrpl/proof/xrpl-11-devnet-2026-10-25.md`,
  and the platform try-steal / inspector-app signer / adapter private vault from #125 / #128 / #121.
  `node docs/submission/check-links.mjs --devnet` re-checks every link (published, validated, result = link text): 64/64 green on 10-25,
  80/80 after XRPL-13b / XRPL-15 / XRPL-11 merged. (Jalil's agent, PITCH-04)
- [10-25] PITCH-04 wording calls: `LoanManage` moved from "not used" into the primitives table once XRPL-15 (#132) proved it on devnet;
  the v2 run's `demo.ts` attestation rows aren't cited (deprecated `xrlp/attestation/v1` memo); the v2 demo's `EscrowFinish` isn't called a suite-gated release
  (it was sent from `platform`, before #125 made `releaseService` the default). (Jalil's agent, PITCH-04)

- [10-25] Prestage (XRPL-11) = three fresh projects per run, pipelined C → B → A (C first: it must wait for its RedemptionDate). A: 6 × 30-day loan, escrow CancelAfter +30/60/90 d. B: M1 released, **M2 (12k) is the stall escrow** (CancelAfter past before the file is written), 12 × 30-day loan so the refund LoanPay is on time and ≥ one periodic payment. C: 2 × 240 s loan (XRPL-06 needs PaymentTotal ≥ 2 and CancelAfter < maturity: C's escrows cancel at +360 s), all escrows released, builder → SPV → two LoanPays pay it off, then wait for RedemptionDate. `--only A,B` re-stages a subset and keeps the rest of `prestage.json` (a rehearsal consumes A's M1/M2 and B's expired escrow; C stays valid). (Jalil's agent, XRPL-11)
- [10-25] `.data/prestage.json` shape = `PrestageFile` in `packages/xrpl/src/prestage-types.ts` (exported, with `parsePrestageFile`); preimages only in `.data/prestage-preimages.json` / `.data/demo-preimages.json` (mode 600, never printed, old entries kept); the writer validates that the file has no preimage/fulfillment/seed field. (Jalil's agent, XRPL-11)
- [10-25] Scripts make every project vault **private** (tfVaultPrivate + platform DomainID + non-transferable shares) by composing `setupProjectOnChain`'s steps in `scripts/demo-lib.ts` (`setupProjectOnChain` got `domainId` / `nonTransferableShares` in XRPL-10, but it fixes SubscriptionDate before the SPV's txs, which would eat the scripts' 60 s deposit window; switch once it can anchor on ledger time at VaultCreate). The CLI demo dropped the `DEMO_SPV_MODE=single` master-key fallback (XRPL-01 proved multisig LoanSet). Scripts delete an old investor3 `KYC_INVESTOR` credential so the `tecNO_AUTH` beat works with v1 wallet files. (Jalil's agent, XRPL-11)
- [10-25] On merging XRPL-11 with XRPL-13b/15: the demo/prestage close uses the default batch mode (one `tfAllOrNothing` Batch row in the tx table, then each milestone's inner EscrowCreate), and the deprecated `generateMilestoneCondition` / `MilestoneCondition` exports are removed from `@xrlp/xrpl` (no users left; core has its own `packages/core/src/conditions.ts`) (Jalil's agent M5, integration)
- [10-25] **Stage check = read-only GO / WARN / NO-GO per beat** (`pnpm --filter @xrlp/xrpl stage:check`, D1–D6 + C withdraw). It submits nothing, reads one validated ledger (every read pinned to its index, time = its `close_time`), and judges with the package's own rules rather than restating them: `evaluatePreflight` at the release margin (300 s), `wrongFinishBlockers`, `cancelReadiness`, `planLoanPayment`, `vaultPhase`, `lockTermsCover` (= XRPL-04 cover sizing). Every time gate must hold until ledger now + window (default 60 min); a gate that holds only now is a WARN. Exit 0 = no NO-GO. A check that gates no beat is advisory and can only WARN, so it never blocks the slot. Fixes merge into one `bootstrap` + one `prestage --only <union>` carrying the caller's `WALLETS_FILE`. — why: the operator gets one command to run, and the check can't drift from what release / cancel / repay will actually accept (Jalil's agent, XRPL-16)
- [10-25] Stage check: the B refund counts as on time only while ledger time ≤ `NextPaymentDueDate` (`planLoanPayment`'s rule), **with no grace credit**. #138's "NextPaymentDueDate + grace" would pass a refund the ledger refuses: from `fixCleanup3_4_0` (on devnet), a LoanPay without `tfLoanLatePayment` after the due date is `tecEXPIRED` (XLS-66 §3.11.4.2 #11), and `GracePeriod` only gates `LoanManage` default. Severity calls: NO-GO = a beat would fail or tell a false story (incl. platform RLUSD < a live lock-terms' cover on A's terms = 3395.58, and investor3 holding KYC); WARN = preimages file not mode 600, a preimage missing for an escrow the demo doesn't release (only A m1 is NO-GO), faucet down, rippled ≠ 3.4.1, `prestage.json` > 60 min old (the ledger checks are authoritative), trustee unfunded (multisig signers need no account), a role under bootstrap's 30 XRP. NO-GO below 2 XRP spendable (balance − reserve). Secrets: preimages are reduced to conditions inside `summarizePreimages`, the wallet file to addresses, and parse errors of both files are reported content-free (Jalil's agent, XRPL-16)
- [10-25] INS-07 re-audit: a new audit **replaces only that inspector's earlier audit** for the milestone (other inspectors' audits stay;
  earlier attestations stay on the ledger) and the milestone's checks go back to `pending` — a suite that evaluated the old report must
  not be shown as certifying or rejecting the new one. The form shows the failed/warn checks from route 2 before the checklist, the
  inspector's previous report, and whether the builder evidence bundle changed; the checklist starts empty (no copied answers).
  Core's CORE-03 branch currently appends re-audits and keeps the old verdict: flagged on #53.

- [10-25] INS-05 history discovers assigned projects through route 18 (including `needs: none`) and reads audits, latest checks,
  and release transactions from route 2, polling every 5s. Results are explicitly **latest per milestone**, not attributed to an
  individual audit revision: the contract has no audit-to-verdict reference. A verdict older than a report is labelled as awaiting
  a new run. Only reports returned by core are shown; superseded reports removed by core cannot be reconstructed. No contract change.
  Added a completed Oak Ave mock project for Dana's pass/release history and aligned the reused Maple M2 photo's GPS with Oak Ave. (Roro's agent)
- [10-25] INS-06 site visit built **mock-only against the area:inspector proposal on #53** (no answer yet), every piece marked
  TODO(#53): `InspectorSiteVisit` (3 questions yes/no/unable_to_confirm + note, photos, notes), `POST /api/projects/:id/site-visit`
  (multipart like route 10), attestation = 1-drop Payment inspector → **platform** (no SPV before lock-terms) with memo
  `{v:1, kind:"site_visit", projectId, hash}` built in the app (not attest-signer: not an XRPL-08 kind). Hash = canonical JSON like
  `auditHash`. http mode posts to the proposed route and shows "core does not support site visits yet" on 404. Draft PR.

## Web action feedback (WEB-12)

- Every shared API error code has presentation copy and a recovery step. Transport
  and ledger failures tell users to inspect the current state before repeating a
  write: a failed response does not prove the preceding transaction never landed.
- Passing checks alone is not a release confirmation. Action toasts distinguish
  confirmed release/refund from pending results; keeper messages describe recorded
  updates rather than promising every expired escrow has already been repaid.
- The demo page hides missing-project 404s only; service errors reach the normal
  error boundary. Web tests use the workspace's existing tsx runner, now declared
  as a web development dependency, with no new top-level tool.
- Projector mode is an opt-in layout control: 20px root text and stronger secondary
  contrast, without changing identity or actions. It survives client navigation,
  resets on a hard reload, and keeps tables in labeled keyboard-scrollable regions.
- Account-directory requests retain an explicit unavailable flag. A failed lookup
  warns in the header and cannot become a "no investor accounts" empty state.

## Pitch review (Jalil's agent, PITCH-09)

- [10-25] PITCH-09 scope: factual errors fixed in `docs/07-pitch.md`, plus the two `docs/08-pitch-storyline.md` lines that repeat a corrected
  07 fact (name decided; slide 8 says the verification fee scales with project size). Factual errors in the demo beats (08 §3,
  `docs/04-demo-script.md`) and positioning changes (hook "impossible", D5 "us trying to release it anyway") go to their owners on #72,
  not edited here. (Jalil's agent, PITCH-09)
- [10-25] Treated as facts, not positioning: "AI judgement can only turn a green into `needs_human`" was wrong (a red required AI check fails
  the milestone: verifier `decide()`, 03 §Release), and so was "`AssetsMaximum` mitigates under-funding" (it only caps over-funding). Left as
  suggestions: "funding-portal status" (funding portals are Reg CF only; counsel words it), "most fraud" (unsourced), inspection pass-through
  counted as revenue in the business illustration. (Jalil's agent, PITCH-09)
- [10-25] New disclosure in `docs/pitch-qa.md` Q2: the platform, as vault owner = loan broker, picks the `LoanSet` borrower, and nothing
  on-ledger binds a vault to its project account. The answer is visibility (SPV + signer list exist from lock-terms, any other counterparty is
  public at once) until a broker co-signed by the trustee exists. Proposed slide-6 row on #72, not applied. (Jalil's agent, PITCH-09)
- [10-25, SUPERSEDED by adopted presentation decision above] Timing assumed a 3:00 pitch + 2:00 demo slot, because PITCH-01 has no slot length yet. Q&A owners in `docs/pitch-qa.md` follow the
  lanes (Jalil XRPL/trust, Sean core/release, Elmir AI/fraud, Roro inspector, Bri product/market/regulatory) and replace 08 §5 once Bri
  confirms on #72. (Jalil's agent, PITCH-09)

## Core store hardening (CORE-08)

- FileStore writers acquire an exclusive filesystem lock, shared across instances
  and processes, before loading state. Lock waits are bounded at five seconds;
  abandoned locks require stopping all writers before manual removal. No age-based
  lock stealing, which could allow two live writers to overwrite each other.
- Atomic writes flush a private temporary file before rename and clean it on
  ordinary failures. Evidence IDs cannot traverse directories. This does not
  change the workflow contracts, ledger-event deduplication, or release vault.

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
