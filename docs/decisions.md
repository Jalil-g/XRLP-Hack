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
- [10-25] Merged `main` @ e67052a verified on devnet end-to-end (bootstrap ×2 idempotent, demo, 5 spikes, compliance, stress, withdraw) — all green, proof in `docs/proof-devnet-2026-10-25-v2.md`. Gaps: demo still uses v1 `attestApproval`; `setupProjectOnChain` creates public vaults (no DomainID); `finishEscrow` always uses the 120 s preflight margin; submit lock ≈ 6.6 s/tx/account (Jalil's agent, devnet verification)

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

- [10-25] Prestage (XRPL-11) = three fresh projects per run, pipelined C → B → A (C first: it must wait for its RedemptionDate). A: 6 × 30-day loan, escrow CancelAfter +30/60/90 d. B: M1 released, **M2 (12k) is the stall escrow** (CancelAfter past before the file is written), 12 × 30-day loan so the refund LoanPay is on time and ≥ one periodic payment. C: 2 × 240 s loan (XRPL-06 needs PaymentTotal ≥ 2 and CancelAfter < maturity: C's escrows cancel at +360 s), all escrows released, builder → SPV → two LoanPays pay it off, then wait for RedemptionDate. `--only A,B` re-stages a subset and keeps the rest of `prestage.json` (a rehearsal consumes A's M1/M2 and B's expired escrow; C stays valid). (Jalil's agent, XRPL-11)
- [10-25] `.data/prestage.json` shape = `PrestageFile` in `packages/xrpl/src/prestage-types.ts` (exported, with `parsePrestageFile`); preimages only in `.data/prestage-preimages.json` / `.data/demo-preimages.json` (mode 600, never printed, old entries kept); the writer validates that the file has no preimage/fulfillment/seed field. (Jalil's agent, XRPL-11)
- [10-25] Scripts make every project vault **private** (tfVaultPrivate + platform DomainID + non-transferable shares) by composing `setupProjectOnChain`'s steps in `scripts/demo-lib.ts` (`setupProjectOnChain` has no `domainId` option yet; worth adding). The CLI demo dropped the `DEMO_SPV_MODE=single` master-key fallback (XRPL-01 proved multisig LoanSet). Scripts delete an old investor3 `KYC_INVESTOR` credential so the `tecNO_AUTH` beat works with v1 wallet files. (Jalil's agent, XRPL-11)

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
