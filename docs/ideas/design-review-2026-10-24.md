# Idea: Design review — architecture flaws, pitch holes, ticket deltas (2026-10-24, T+0)

- **Author / agent:** Jalil's agent (Claude), with two Opus review passes over the five `scaffold/*` branches.
- **Problem it addresses:** judges will attack the trust model and the drift between what we *say* and what the code *does*.
- **What it is:** findings + the honest line for each + concrete ticket deltas. No code was changed.
- **Status:** proposed. Owners: see the lane tags. Companion: `docs/08-pitch-storyline.md`.
- **Inputs read:** docs 01–07, `docs/xrpl-protocol-notes.md`, `docs/05-api.md`, `docs/06-tickets.md` (all on `scaffold/architecture-docs`),
  `packages/shared`, and the code on `scaffold/xrpl`, `scaffold/core`, `scaffold/verifier`, `scaffold/web`, `scaffold/ledger-signer`.

## TL;DR (read this if nothing else)

1. **The code still implements the old trust model.** xrpl: signer list `inspectorA/B w2, aiAgent w1, platform w1`, preimages generated server-side,
   cover rates 0. core: weighted quorum, `FileInspectorKeyring` writes every fulfillment to `DATA_DIR`. **As built, one server holds an SPV quorum and
   every release key.** The pitch's central claim ("the platform never holds a fulfillment", "no single party controls the project account") is false
   until XRPL-05/06, CORE-01/02 and INS-04 land. Treat those as the critical path, not "finishing".
2. **`docs/07-pitch.md` and `docs/04-demo-script.md` on `main` still say the old model** ("inspector plus AI meets quorum", "AI has weight 1 on the
   multisig", "preimage split 2-of-3", "escrow expires → investors made whole"). Q&A #4 and #9, the two most dangerous questions, have *wrong rehearsed
   answers*. PITCH-02 fixes 04 but **nothing owns 07** → new ticket PITCH-09 below.
3. **The web UI overclaims the same way** (`approvals-panel.tsx` "weight 2 plus one more signer", `escrow-guarantee.tsx` "second signer: the AI",
   `mock-data.ts` share price rises on repay, "No matches across 1,284 indexed photos", "XRPL devnet · live" while on mock). A judge who reads the
   screen while we talk will catch it.
4. **A failed `EscrowFinish` with the *right* fulfillment (e.g. `tecNO_LINE` because the builder has no RLUSD trust line) publishes the preimage
   while the escrow stays open.** Anyone can then finish it, bypassing the whole approval policy. Not disclosed anywhere. Needs a pre-flight check in the
   release path (builder trust line exists, escrow still open, `CancelAfter` not passed) *before* the inspector reveals.
5. **First-loss cover is cosmetic in code** (`LoanBrokerSet` without `CoverRateMinimum/CoverRateLiquidation` → `DefaultCovered = 0`). The deck says 10%.
   The explorer will show the truth.
6. **The prestage plan contradicts itself and will break the stall beat.** "Expires ≈2 min after staging" vs "reset ≤30 min before the slot". A stalled
   project's loan will also be *late* by demo time (300 s interval / 60 s grace), and an overpayment `LoanPay` must be on time → the refund fails on stage.
7. **Scope.** 66 tickets, ~30 h per person, two front-ends plus an HTTP server, in 36 h with sleep. The minimum demo (§E) needs ~20 of them. Decide the cut
   list now, not at T+24h.

## A. Code-vs-design drift, by lane (owner → fix in ticket)

| Lane | What the code does today | Design says | Ticket |
|---|---|---|---|
| xrpl | `spv.ts:17-25`, `api.ts:145-154` signer list inspectorA/B w2, aiAgent w1, platform w1; no `trustee` wallet | `{platform, builder, inspector, trustee}` w1, quorum 3; AI off the list | XRPL-05 |
| xrpl | `condition.ts:40-43` generates preimage in Node; `demo.ts:149-153` same process | inspector client generates; core gets only the condition | XRPL-06 + INS-04; demo script may keep a *labelled* software keyring |
| xrpl | `api.ts:122` `LoanBrokerSet` has no `CoverRate*`; cover deposit optional; `loan.ts:56` liquidation defaults to minimum | `CoverRateMinimum=10000`, `CoverRateLiquidation=100000`, `LoanBrokerCoverDeposit` 10%, `cover_deposited` event | XRPL-04 |
| xrpl | no duplicate-condition rejection (`api.ts:244-247`); any assigned inspector can overwrite another's condition | reject duplicates; condition bound to its inspector | XRPL-06 / CORE-03 |
| xrpl | `PaymentTotal = max(1, …)` (`api.ts:255`); `InterestRate` unguarded; `CancelAfter < maturity` unchecked (`demo.ts:166` 30 d vs 20-min loan) | `PaymentTotal ≥ 2`, `InterestRate > 0`, `CancelAfter < maturity` | XRPL-06 |
| xrpl | LoanSet `Fee` via autofill (`loan.ts:117`) | set by hand ≥ `(1 + signers + counterpartySigners) × base` | XRPL-06 |
| xrpl | no `tfVaultPrivate`/`DomainID`; `credentials.ts` is a TODO | private vault, KYC gating | XRPL-08 (non-critical, but the "who can invest" answer depends on it) |
| xrpl | `submitBlob` has no retry, no per-account mutex, LLS ≈ 20 ledgers (`client.ts:76-97`) | retries, mutex, LLS = current + 150 for human-signed txs | XRPL-12 |
| xrpl | no `adapter.ts`, no `getEscrow`/snapshots, no `TooSoonError` | `LedgerPort` per 05 §3 | XRPL-09/10 |
| core | `quorum.ts:7-8,35-47` weighted quorum; inspector+platform releases with no AI pass; no override attestation | release policy: inspector approved ∧ fulfillment matches ∧ (AI pass ∨ override) | CORE-02 |
| core | `FileInspectorKeyring` stores fulfillments on disk (`inspector-keyring.ts:33-52`, `seed.ts:21-32`); `ports.ts:54` "adapters own preimages" | core never stores a fulfillment before approval | CORE-01/03 (delete the keyring from the devnet path; fake mode may keep it) |
| core | autoClose fires on the deposit that fills the raise (`service.ts:548-550`) | close only after `SubscriptionDate` (`tecTOO_SOON` otherwise) | CORE-03 |
| core | one refunded milestone → whole project `stalled` (`:887-892`) and `submitEvidence` refuses other live escrows (`:626`) | stall is per-milestone; other escrows keep running | CORE-03 |
| core | `expireMilestone` does cancel + LoanPay non-idempotently; retry re-cancels → `tecNO_TARGET` (`:875-886`) | keeper idempotent per step | CORE-06 |
| core | withdraw allowed while `escrowed` (`:964`); `funding → stalled` says "investors withdraw" | withdraw only in Redemption | CORE-03 |
| core | no `signedTxBlob` on attest → inspector attestations are server-signed | client/Ledger-signed blob accepted (route 10) | CORE-03 / INS-06 |
| verifier | no `verdictHash` anywhere; ledger-signer uses `"9f".repeat(32)` placeholder | canonical sha256 for the AI attestation | VER-07 |
| verifier | live mode: no client timeout / `maxRetries` (`live.ts:71`); image processing outside `try` (`:79`); LLM-read invoice totals labelled deterministic at 0.99 (`checks.ts:228`) | fail closed, bounded latency | VER-04 |
| verifier | filename unescaped into prompt (`live.ts:46`); doc text passed as document block; only one prompt line of defence | injection can flip `needs_human` → `pass` (not a deterministic fail) | VER-11 |
| verifier | fixtures are 384×256 SVG cartoons, EXIF Model "SyntheticCam (demo fixture)", file named `framing-04-reused.jpg`; live prompt tells Claude to flag renders | live vision will likely fail the *pass* case | VER-01 (real photos, neutral names) |
| web | `lib/api.ts` mock only, `DATA_MODE` hard-coded; route names differ from 05 §2 (`/invest` vs `/investments`, `review` vs `verify`, `attest` vs `attestations`, `expire` vs `cancel`); missing condition/lock-terms/withdrawals/keeper/events | thin client over 05 §2 | WEB-01 |
| web | `mock-data.ts` (1,100 lines) holds business logic in the **old** model: weights (`:562`), platform auto-approves (`:558`), share price rises on repay (`:649`) | no business logic in apps | WEB-01/03 |
| web | `inspector/page.tsx` links to a nonexistent :3001; inspector is a `/demo` button | `apps/inspector` | INS-01.. (does not exist yet, 0 lines) |
| ledger-signer | Speculos-proven: attestation + multisig EscrowCreate/Finish clear-signed, deterministic sigs. **Untested:** real device, WebHID, devnet submission, reject mapping (0x6985 ambiguous) | — | INS-09 |

## B. Trust-model holes (design, not just code), ranked by damage on stage

Each row: the hole · is it disclosed in docs today · the one honest line to say.

1. **One machine holds an SPV quorum and every release key (demo).** Platform, trustee, aiAgent, demo investors and builder keys live in core
   (`05-api.md` §1). Disclosed: *partially* ("trustee is server-held"), never as "server = quorum". **Say:** "In the demo one laptop holds every key except
   the inspector's. The ledger still guarantees escrowed money has two destinations only."
2. **The AI gates nothing on-ledger.** The AI-pass rule is client policy the platform ships. Disclosed: yes (03 §Escrow gating). **Say:** "AI is a signal
   plus an on-chain record. Ledger-enforced multi-party release is Smart Escrows, XLS-100, not on devnet."
3. **3-of-4 can `SignerListSet` and capture the SPV**, owning all future refunds; `LoanPay` is voluntary. Disclosed: understated ("only liquid RLUSD").
   **Say:** "Capture can't touch live escrows. It stalls the loan into default, where first-loss cover and the write-down apply."
4. **Released money is unsecured.** No lien/deed in the design. Disclosed: as an open question. **Say:** "Released money is credit risk, that's lending.
   Small milestones, first-loss cover, and a deed of trust held by the SPV off-chain."
5. **Inspector + builder collusion** releases one milestone early. Disclosed: yes. **Say:** "Bounded to that milestone, to that builder, signed by name."
6. **Cover is cosmetic in code** (see TL;DR 5). Disclosed: no. Fix the code; don't say 10% until the explorer shows it.
7. **Failed finish leaks the preimage** (TL;DR 4). Disclosed: no. Fix: pre-flight checks before reveal; never submit a finish you expect to fail.
8. **Condition substitution at creation** is caught by a UI the platform serves. Disclosed: yes. INS-05 reading devnet JSON-RPC directly is the right fix; say "the inspector app checks the ledger, not our server."
9. **KYC is off-chain-only until the private vault lands**; keeper is platform-run (liveness only); mock issuer key is platform-held. Disclosed: keeper yes, KYC state no.
10. **Under-funded project locks investors until `RedemptionDate`.** Disclosed: yes (open). **Say:** "`AssetsMaximum` = principal, platform backstop, short redemption for unfunded. Open design item."
11. **Interest accrues on undrawn principal** (Design B). Contradicts Pain 1 ("cheaper credit"). Disclosed: yes. **Say:** "Committed capital, near-zero risk while escrowed, so the fair rate is below a bank's drawn rate. Compare all-in cost."
12. **Inspector assignment is fixed at loan close** (condition immutable) → "rotated randomly per milestone" (07 Q&A #1, #12) is impossible as stated. Rotation is per project.

## C. Pitch holes (what's wrong or weak in 01/04/07 as they stand on `main`)

| Where | Problem | Fix |
|---|---|---|
| 07 script beat 6, Q&A #4 | "Inspector plus AI meets quorum", "weight 1 on the multisig" | AI holds no key; attestation only. See 08 §5 |
| 07 Q&A #9 | "split 2-of-3" | Inspector is the release key; platform never holds a fulfillment. The single most dangerous wrong answer we have |
| 07 beat 8, 04 beat 8, 01 wedge #5 (main) | "escrow expires → money flows back → investors made whole / withdraw" | cancel → SPV → multisig `LoanPay` → redeem at `RedemptionDate`. Not automatic |
| 07 beat 4, 02 flow #8 | "share value rises as repayments land" | rises at `LoanSet`; repayments restore liquidity |
| 07 Q&A #1, #12 | "rotated randomly per milestone" | per project, before close |
| 07 Q&A #4 | "verdict and reasons are hashed on-chain" | not true until VER-07 + aiAgent attestation ship. Don't claim it before it exists |
| 07 beat 2 | "AI agent reviews license, insurance" | `verifyBuilder` is regex over a mock registry, no LLM. Say "automated checks against (mock) registries", or wire the LLM |
| 07 script total | 3:25 at best; over by 25 s before any tx latency | 08 §4 is 3:00 with a cut order |
| 01 Pain 1 | implies we lower builders' rates; we don't (Design B) | reframe: we lower *lender risk and operating cost*, which is the path to lower rates |
| 01 Pain 2 | weakest evidence (Trustpilot, secondary sources) and invites the securities question | lead with Pain 3 (draw process) + Nightingale custody story; keep Pain 2 to one line |
| 07 business | "~3% of principal per loan" illustration mixes an unimplemented inspection fee with protocol fees | keep; label as illustrative; make sure `LoanOriginationFee`/`ManagementFeeRate` are actually set non-zero in `LoanSet`/`LoanBrokerSet` so the explorer backs the slide |
| 07 "why XRPL" | fine, but the inspector-as-key model narrows the gain over a bank escrow agent | lead with: destination fixed at creation, public audit trail of named approvals, programmable refund via `CancelAfter`, native primitives (no contract to exploit), seconds and cents |
| framing A vs B | still open in decisions; 07 and judge-critique both say "pitch B, keep A's story" | decide now: institutional-first narrative, demo unchanged (08 §1). Per-payee escrows only if demo-critical is green at T+24h |
| Ledger bounty | page says "Testnet counts", never devnet; Ledger can't sign `LoanSet`; `LoanPay`/`Vault*` are blind-signed | ask at booth in hour 1; keep the device on attestation + `EscrowFinish` (clear-signed) and say so |
| name | TBD; deck and UI header blocked on it | pick by T+6h (recommend Drawproof) |

## D. Demo-timing and prestage risks (XRPL-11 / CORE-07)

1. **Stall project:** stage it with `CancelAfter` **already past** (cancel works any time after), and give it a long `PaymentInterval` so the refund `LoanPay`
   is still "on time". Prove the "not yet expired" case on a different project if needed.
2. **Redeemable project:** needs short terms (`interval × total + 60 ≤ RedemptionDate`) and must be fully repaid → a *separate* project from the stall one.
3. **Ready-to-close project:** generous `RedemptionDate` or `LoanSet` returns `tecNO_PERMISSION`.
4. **Beats 4 and 5 deposit into and close the same vault.** Either create it live with `SubscriptionDate ≈ now + 75 s` and talk through the countdown, or
   make it two projects and say so. The 08 storyline avoids this by showing a pre-staged funded+closed project (D1).
5. Core `autoClose` must be decoupled from the filling deposit or it hits `tecTOO_SOON` / blocks the request for minutes.
6. No retries or per-account mutex yet → `tefPAST_SEQ` under concurrent platform txs. XRPL-12 before rehearsal 1, not T+28h.
7. `DEMO_WITHDRAW` comment says ~10 min; actual ≈ 24 min (`demo.ts:8,123-124`).

## E. Scope: the minimum demo and the cut list

**Minimum that delivers the 08 storyline (D1–D5):** XRPL-01..07, 09, 10, 11, 12 · CORE-01..07 · VER-01, 02, 03, 07, 09 · WEB-01, 03, 04, 05, 10, 11 · INS-01, 02, 04, 05, 06, 07.
That is ~34 tickets, ~75 h of the 150 planned. Everything else is polish or bounty.

**Cut first if T+14h slips:** WEB-02 marketplace, WEB-06 invest flow (pre-stage deposits), WEB-07 portfolio, WEB-08/09 builder pages, VER-05/06/08, INS-08 XOR split
(use 1 inspector for all milestones), XRPL-08 compliance (talking point only), XRPL-13 Batch.
**Cut last:** INS-09 Ledger (bounty, but also the best stage moment), VER-04 live vision (mock is deterministic and honest if labelled).

**Suggested re-order:** XRPL-05 (new signer list) and CORE-02 (release policy) move to the T+6h checkpoint. They are the trust model; without them we are
demoing the thing we say we are not.

## F. Protocol facts to verify on devnet in hour 1 (we are asserting them on stage)

- Closed-ended gates: `tecNO_PERMISSION` for `LoanBrokerSet` on an open-ended vault; `tecTOO_SOON` for `LoanSet` before `SubscriptionDate`; 180 s minimum window.
- `VaultWithdraw` ignores the domain (we claim investors can't be locked out; the platform *can* delete credentials).
- `tecNO_LINE` on finish to a builder without a trust line, and that the fulfillment is then public (hole B7).
- `tecCRYPTOCONDITION_ERROR` on a wrong fulfillment **is recorded on-ledger with an explorer link** (needed for the "Ledger says no" beat).
- Devnet base fee is 1 drop (unusual; affects hand-set `LoanSet` fee).
- 3-of-4 weight-1 counterparty signing with 3 signers (the proven run used the old 2-signer list; no hashes recorded, run record is in gitignored `.data`).
- Ledger device: memo display on `EscrowFinish`, and one devnet submission from a device-signed blob.

## G. Ticket deltas (proposed; mirrored as GitHub issue comments)

- **New PITCH-09 (area:pitch, S, demo-critical, T+14h):** rewrite `docs/07-pitch.md` script + Q&A #1/#4/#7/#9/#12 to the new trust model; adopt `docs/08-pitch-storyline.md` as the script; add the "who can move the money" slide. Owner: @bri-yin (deck) with @Jalil-g (trust answers).
- **New DEMO-01 "Ledger says no" (area:core + area:web, S, T+24h):** route `POST /api/admin/demo/try-steal/:mid` submits an `EscrowFinish` with a wrong fulfillment from the platform key; UI button on `/demo` shows the `tec` result and explorer link. Must never use the real fulfillment.
- **New XRPL-14 / CORE-12 pre-reveal safety (S, demo-critical):** before core submits a finish, check: escrow exists and is open, `CancelAfter` not passed, destination has an RLUSD trust line. Refuse otherwise with `condition_mismatch`/`invalid_state`. Document hole B7 in 03.
- **XRPL-04 AC add:** `CoverRateMinimum=10000`, `CoverRateLiquidation=100000` set on `LoanBrokerSet`; `LoanOriginationFee` and `ManagementFeeRate` non-zero so the business slide is on the explorer.
- **XRPL-05 / CORE-02 move to T+6h** (trust model is the demo).
- **XRPL-11 AC fix:** stall project staged with `CancelAfter` already past and long `PaymentInterval`; redeemable project separate and fully repaid; ready-to-close project with generous `RedemptionDate`.
- **CORE-03 AC add:** autoClose decoupled from deposits; stall per milestone; withdraw only in Redemption; delete `FileInspectorKeyring` from the devnet path (fake mode may keep it, labelled).
- **VER-01 AC add:** real photos re-stamped with `stampExif`, neutral filenames, reused copy with a *fresh* EXIF date so pHash alone catches it; side-by-side "matches Oak Ave project photo, distance 3/64, different sha256" in the reason.
- **VER-04 AC add:** client timeout + `maxRetries`, image processing inside the fail-closed path, LLM-sourced totals labelled as such.
- **WEB-01/03 AC add:** route names per 05 §2; remove weights/auto-approve/share-price-on-repay from `mock-data.ts`; "mock" badge while `DATA_MODE=mock`; copy fixes in §C.
- **INS-09 AC change:** strongest 20 s = device clear-signs the `EscrowFinish` carrying fulfillment **and** an attestation memo whose `verdictHash` matches the verdict card; press Reject on a second milestone → stays locked. Verify memo display on `EscrowFinish` in Speculos first.
- **PITCH-01 add:** ask Ledger booth whether devnet counts; ask organizers for rubric and demo length (past XRPL Commons events: Innovation · Execution · Impact · Pitch).
- **decisions.md:** log the framing decision (institutional-first narrative, demo unchanged) and the name by T+6h.

## Addendum (same day, after direction v2)

The team direction changed to the **test-suite release model** (`docs/02-product.md`, `docs/03-architecture.md`, `docs/decisions.md`
"Direction v2"). Effect on the findings above:
- **Superseded:** B1/B2 as stated (inspector = release key). The platform's release service now holds preimages *by design*, disclosed on
  slide 6; the honest line is Q&A #2 in `docs/07-pitch.md`. INS-04/05/08 v1 are retired, so §A rows about the keyring/condition check are moot.
- **Still true and now more important:** B7 (failed finish leaks preimage → XRPL-14 + CORE-12 `preflightFinish`), B3 (3-of-4 capture bound),
  B6 (cover rates 0 in code), §D prestage fixes, §E scope, §F hour-1 verifications, the web/verifier copy and route drift.
- **New risk introduced by v2:** the AI is now the gate, so Q&A #1 ("AI is your oracle") is the most dangerous question. Mitigation is
  architectural, not rhetorical: most checks deterministic, inspector audit mandatory, every result attested before the finish, `needs_human`
  resolved by a named operator with a signed reason. If VER-04 (AI judgement) is late, the demo still works on deterministic checks + audit.
- Tickets v2 and the issue sync replace §G.
