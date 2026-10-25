# Pitch Q&A: the 20 hardest judge questions (PITCH-09)

> Rehearsal sheet for #72, 2026-10-25 (Jalil's agent). Each answer is at most 3 sentences, 25–31 s in full at 150 wpm (longer than
> 07's ~20 s target). The **first sentence (5–14 s) is the answer** if a judge cuts in; the rest is the mechanism. Same style as
> `docs/07-pitch.md` §Judge Q&A, which keeps the easier ones (SoV/skyscraper #6, mainnet #12, RLUSD freeze #14, hardware wallet #15, robots #16).
> **Owners are proposed by lane**: Jalil = XRPL/ledger/trust model · Sean = architecture/core/release service · Elmir = AI verification/fraud ·
> Bri = product/UX/market · Roro = inspector workflow. Bri confirms on #72; then this replaces `docs/08-pitch-storyline.md` §5.
> Sources: `03` = `docs/03-architecture.md` · `PN` = `docs/xrpl-protocol-notes.md` · `P2` = `docs/proof-devnet-2026-10-25-v2.md`
> (PR #126) · `D` = `docs/decisions.md`. Devnet links die when devnet resets; PITCH-04 keeps the current set.
> Never say: "trustless AI", "ledger-enforced release", "mainnet-ready", "automatic refunds to investors" (`docs/00-overview.md`).

## Who answers what

| # | Question | Owner | Backup |
|---|---|---|---|
| 1 | Isn't the platform still trusted? | Jalil | Sean |
| 2 | What stops you lending the pool to yourself? | Jalil | Sean |
| 3 | Who is the trustee? | Jalil | Sean |
| 4 | What if the builder defaults? | Jalil | Bri |
| 5 | What happens if funding falls short at `SubscriptionDate`? | Bri | Jalil |
| 6 | Why a closed-ended vault? | Jalil | Bri |
| 7 | Why not Smart Escrows or Hooks? | Jalil | Sean |
| 8 | Why XRPL and not an EVM chain? | Jalil | Bri |
| 9 | Is the loan close atomic? | Jalil | Sean |
| 10 | What if the preimage store leaks, or a release fails halfway? | Sean | Jalil |
| 11 | Interest on undrawn principal: how is that cheaper? | Sean | Bri |
| 12 | You hold the real secret, so what does "Ledger says no" prove? | Sean | Jalil |
| 13 | The AI releases the money. Isn't it your oracle? | Elmir | Jalil |
| 14 | Can the AI be prompt-injected or fooled? | Elmir | Sean |
| 15 | Is that verdict real AI or a mock? | Elmir | Sean |
| 16 | How do you stop photo reuse? | Elmir | Roro |
| 17 | Who's accountable if an inspector signs off on bad work or colludes? | Roro | Elmir |
| 18 | "Seconds"? The inspector still has to visit. | Roro | Bri |
| 19 | Unregistered securities? KYC? | Bri | Jalil |
| 20 | Built already does AI draw review. Why you? | Bri | Roro |

## Trust model

**1. "Isn't the platform still trusted?"** (Jalil)
Yes, for *when*: our release service holds each escrow's secret and finishes only after the suite is green, and slide 6 says so. Not for
*where*: the destination is fixed at `EscrowCreate`, so the worst case is an early release to the right builder, never a redirection, and
public attestations precede every release. Putting the suite itself on-ledger needs Smart Escrows (XLS-100), not on devnet: that's the roadmap.
*Sources:* 03 §Escrow gating · D Direction v2 ("Preimages are held by core's release service") · PN §0 · `packages/core/src/release-service.ts`.

**2. "What stops you lending the pool to yourself?"** (Jalil)
Nothing on-ledger, and we say so: XLS-66 makes the vault owner the loan broker, and the broker co-signs `LoanSet` with whichever borrower it
picks. What we have is visibility: the project account and its 3-of-4 signer list exist from lock-terms, before any deposit, and a `LoanSet`
to anyone else is public within seconds. Binding it on-ledger would need a broker account co-signed by the trustee, which we haven't built.
*Sources:* PN §2 (vault owner = broker owner; either party initiates `LoanSet`) · `docs/05-api.md` route 6 (lock-terms creates vault, broker,
cover and SPV before funding). New disclosure; proposed slide-6 row on #72.

**3. "Who is the trustee?"** (Jalil)
The fourth signer on each project account, an independent investor representative, so the platform always needs two outside parties and
no single signer can block (devnet: any 3 of 4 succeed, the AI key is rejected). Who fills the seat in production is still open in our
decisions log. In the demo its key, like every demo key except an inspector signing in the app, sits on our server, and we say so.
*Sources:* 03 §SPV signer list · P2 §4 (`spike:spv`: 2 of 4 `tefBAD_QUORUM`, AI key `tefBAD_SIGNATURE`, three different triples
`tesSUCCESS`) · D Open ("Trustee identity") · `docs/05-api.md` §1 (demo key custody).

## Money, default and liquidity

**4. "What if the builder defaults?"** (Jalil)
Unreleased money comes back: escrows expire to the project account, which repays the vault (devnet: cancel, then a 9,000 `LoanPay`). Released
money is credit risk: after due date plus grace we call `LoanManage` default, and in that same transaction our first-loss cover pays the
vault 10% of the outstanding debt while the vault writes down the rest. Proven on devnet (XRPL-15): the cover returned exactly 10% of what was
outstanding, 1,000 unpaid → cover 100 → share price 1 → 0.1, and with 600 refunded first, 400 unpaid → cover 40 → 1 → 0.64; a deed of trust is off-chain.
*Sources:* PN §3c ([default: cover 100](https://devnet.xrpl.org/transactions/B3A32FB9CFF5A7F015CE7C61972BA1DF18E2371E3715DE8443B93B1FA8946568),
[600 refunded first: cover 40](https://devnet.xrpl.org/transactions/6FE6525D37DCB9EFBA53D9E8C00D987E17CB4D8F976D97041698389C1512A19E),
[`LoanPay` after a default → `tecKILLED`](https://devnet.xrpl.org/transactions/DD914351CA868D89D1E350FFFF20A4354A0840053B34578EB885F62764062FF4)),
PN §2 (`DefaultCovered` math), §3 stall path · P2 §1 rows 27–28
([EscrowCancel](https://devnet.xrpl.org/transactions/3BD1B494EEAC9A897879434E7657C95C8F19C485053D825F44E5E59E9F0F5AF0),
[LoanPay 9,000](https://devnet.xrpl.org/transactions/686028E03383EC8AC3DE4CEF02B087822EA06D1EF34E6A7906E974C247EA4B25)) · cover is enforced
at close: [`LoanSet` with too little cover → `tecINSUFFICIENT_FUNDS`](https://devnet.xrpl.org/transactions/1186024CBF707D61A4CB935CE37D652DF0A9E826CB939B76166FFDE18BA867B8) · D Open ("Default handling").

**5. "What happens if funding falls short at `SubscriptionDate`?"** (Bri)
Today it waits: after `SubscriptionDate` the closed-ended vault takes no deposits and blocks withdrawals until `RedemptionDate`
(`tecTOO_SOON` on devnet), so an under-funded project's investors sit without yield until then. The fix we're weighing is a platform backstop
for the shortfall so the loan still closes; `AssetsMaximum` only stops over-funding, and a shorter `RedemptionDate` would also shorten the
loan. Open item in our decisions log, and we say so.
*Sources:* PN §3 (V1_1 lifecycle; the loan must fit before `RedemptionDate`) · P2 §9
([withdraw during Investment → `tecTOO_SOON`](https://devnet.xrpl.org/transactions/21EAA2198D02F0307B7D15A7E4817690C7E3C2B3B6A8D9AD8AF7C7531296A1E4)) ·
D Open ("Under-funded at `SubscriptionDate`") · `docs/05-api.md` route 15 (`too_soon` before `RedemptionDate`).

**6. "Why a closed-ended vault?"** (Jalil)
Because devnet's `LendingProtocolV1_1` requires it: a loan broker on an open-ended vault fails with `tecNO_PERMISSION`. It also fits project
finance: subscription is the funding deadline, `LoanSet` is refused before it (`tecTOO_SOON`), and from `RedemptionDate` (maturity + buffer)
investors withdraw whatever has been repaid, even with the loan still open. The cost is liquidity during the build, plus the shortfall case in Q5.
*Sources:* PN §3 · P2 §2
([open-ended → `tecNO_PERMISSION`](https://devnet.xrpl.org/transactions/762EC20CBC35269FB541966BAA4774EE8456B7CCF8E77E3E0D35AE0791A8202B),
[`LoanSet` early → `tecTOO_SOON`](https://devnet.xrpl.org/transactions/3044308449A0C4C2534E39C96B75B20C39E8EED964FDCAF4BCC6353B8B963BE4)) ·
P2 §9 ([withdraw at Redemption, loan still open](https://devnet.xrpl.org/transactions/A230228D480A2CA182C2228D8256B33B474A85A710E53E07130A66290D8CAF11)).

## Why this ledger, why this design

**7. "Why not Smart Escrows or Hooks?"** (Jalil)
Neither is on the devnet where the Lending Protocol lives: Smart Escrows (XLS-100) exist only as an experimental xrpl.js build, and Hooks
aren't there at all. So we used only native, enabled primitives, no contract of ours holds money, and we say plainly that release timing is
our suite, not a ledger rule. When Smart Escrows land, the suite's result becomes the escrow's finish condition: our roadmap slide.
*Sources:* PN §0 (feature list: Smart Escrows / Hooks not present; xrpl.js `5.4.0-smartescrow.0` only) · PN §1 option table.

**8. "Why XRPL and not an EVM chain?"** (Jalil)
You could build this on EVM, and hackathon teams have, with custom contracts. On XRPL every guarantee we claim is a native primitive (vault
shares, loan terms, first-loss cover, fixed escrow destination, quorum, KYC), so no contract of ours holds money and there's nothing bespoke
to exploit. RLUSD settles in ~4 s for a fraction of a cent, and everything but Vault/Lending is already live on mainnet.
*Sources:* `docs/01-problem.md` §On-chain prior art (Cornerstone, BrickByBrick, BuildLink) · `docs/07-pitch.md` §Why XRPL. Mainnet
activation dates from press reports quoting RippleX (check XRPScan before stage): Credentials 2025-09-04, Permissioned Domains 2026-02-04,
Token Escrow 2026-02-12.

**9. "Is the loan close atomic? Couldn't the project account sit on liquid principal?"** (Jalil)
Not fully: devnet's rippled 3.4.1 rejects `LoanSet` inside a Batch (`temINVALID_INNER_BATCH`) until `LendingProtocolV1_2`, so a fully atomic
close is one amendment away (code written and tested offline). Today the close (2–8 milestones) is `LoanSet`, then all escrows in one all-or-nothing Batch,
with principal liquid for ~2 ledgers; a rolled-back Batch is detected and the missing escrows are re-created exactly once. Even in that
window, moving principal needs 3 of 4 signers, two of them outside the platform.
*Sources:* PN §2d (F1/F2 rejected;
[E2: 3 escrows, one Batch](https://devnet.xrpl.org/transactions/05612B4D17E66B37FFA64139CD2BA2163642D76122C7FC319FF1407253DBC5B8)) ·
PN §2e (the close path: [LoanSet](https://devnet.xrpl.org/transactions/4661D0C6F321BA6DD46887294EA1C86B36F812FD9C0C1969016BD0CFA6148A70),
then [one Batch of 3 escrows](https://devnet.xrpl.org/transactions/1DD530999139C1867549DAB971D9D01438A28093B16772A84E132CFE976EFB89) 2 ledgers later;
[rolled back](https://devnet.xrpl.org/transactions/AF14693582FDB295889241F74A4688EEA2BC8AFF85A5EAB061B756181299C989) →
[resumed](https://devnet.xrpl.org/transactions/EE8F9497C3EA7BA85081B933ECAF09D89BD8C532309F800F0E82DD1263782DBD)) ·
D [10-25] XRPL-13 and XRPL-06 (close validated before the first tx).

## Release service and core

**10. "What if the preimage store leaks, or a release fails halfway?"** (Sean)
Each escrow has its own random 32-byte secret, encrypted at rest (AES-256-GCM; KMS/HSM in production), so a leak can only release those
escrows early, to the right builder. The real trap is a failed finish: on devnet a `tecNO_LINE` finish published the fulfillment with the
escrow still open, and a third party finished it. So every finish first runs a preflight on the validated ledger (escrow open, condition
matches, trust line, time left) and refuses before signing.
*Sources:* `packages/core/src/release-service.ts` (header) · PN §1a · P2 §5 rows 15–18
([`tecNO_LINE` carrying the fulfillment](https://devnet.xrpl.org/transactions/2B3D5CBFBF4A077FC7A5461CB0882EF7575285700C3E849D184E33B2D292B816),
[third-party finish](https://devnet.xrpl.org/transactions/11D1122DB9D8143B4F6D46DC522964E8C1CB33A332E053BD5214CA9FBBAB2B1D)) · P2 §6
(preflight refusals) · D [10-24] XRPL-14.

**11. "Interest accrues on undrawn principal: how is that cheaper for the builder?"** (Sean)
On rate, it isn't yet: `LoanSet` pays out the whole principal at once and we escrow it, so interest runs on the full amount from day one.
Our case: escrowed principal can only reach this project or come back, so it deserves a lower rate; one loan per milestone is the production
alternative. Our demo rate (10–11%) sits inside the AD&C range builders pay (9.36–11.68%, NAHB), so the win is risk and speed, not the coupon.
*Sources:* 03 key fact 1 · D Sean's calls (design B) and Open ("Interest on full principal") · `docs/01-problem.md` Pain 1 (NAHB rates) ·
demo terms: `packages/core/src/demo/scenario.ts` (`interestRateBps: 1100`), xrpl `demo` (10% APR).

**12. "You hold the real secret, so what does 'Ledger says no' prove?"** (Sean)
Not that we can't release: our release service holds the real secret, and we say so. It proves the limit: our own platform key submits a
finish with a random fulfillment and the ledger records `tecCRYPTOCONDITION_ERROR` with nothing moved, because no signature, signer list or
quorum opens an escrow, only its secret. And even the secret can only pay this builder.
*Sources:* `docs/05-api.md` route 23 · `packages/core/src/release-service.ts` ("steal: … platform-signed finish with RANDOM bytes") · PN §1
(anyone may finish; the SignerList has no effect) · P2 §5 row 12
([`tecCRYPTOCONDITION_ERROR`](https://devnet.xrpl.org/transactions/61E13CB3CE9297886E7A46C784951B9D1E5BD75335C0D026A3FA47673C22A2B5)).

## AI verification and fraud

**13. "The AI releases the money. Isn't the AI your oracle?"** (Elmir)
It's one gate of several and can only hold money back: most checks are deterministic, plus a licensed inspector's signed audit, and no AI
pass can outvote a red one. A red AI check fails the milestone; low confidence, a model error or a timeout goes to `needs_human`, decided by
a named operator with a signed reason. Every verdict is hashed on-chain before the finish, so anyone can check the suite was green.
*Sources:* `packages/verifier/src/verifyMilestone.ts` (`decide()`: any required `fail` → fail; non-pass or below `minConfidence` →
`needs_human`) · `packages/verifier/src/policy.ts` · 03 §Release · `packages/xrpl/src/attest.ts` (memo carries the verdict hash).

**14. "Can the AI be prompt-injected or fooled?"** (Elmir)
Sometimes, so being fooled can't release money on its own: evidence, filenames, notes and documents reach the model as untrusted data, and
the deterministic checks and signed audit gate release regardless. Our adversarial fixtures (an image reading "APPROVED", instructions hidden in
audit notes and documents, stripped EXIF, a corrupt image) all come back `fail` or `needs_human`, and model errors fail closed to a human.
Honest limit: those results are in mock mode; live-model robustness isn't measured yet.
*Sources:* `packages/verifier/src/llm/live.ts` (untrusted-data prompt, 20 s timeout, no retries) · `pnpm --filter @xrlp/verifier eval`:
14/14 in mock, incl. 6 adversarial (run 10-25 on `main` @ 8a8d567) · VER-10 PR #120 (live acceptance pending).

**15. "Is that verdict real AI, or a mock?"** (Elmir)
The demo runs the verifier in mock mode: deterministic on our fixtures and labelled `[mock]` on screen. Live mode exists (Claude, structured
output, 20 s cap, fails closed to a human), but we haven't shown it passing our demo photos yet, so we don't claim a live pass. Every
deterministic check and the inspector-audit check run the same code in both modes; only the three judgement checks are stubbed.
*Sources:* `packages/verifier/API.md` §Fixtures and limits ("Live vision has not been demonstrated") · `packages/verifier/src/llm/mock.ts` ·
mock run of the Maple St M1 fixture: `pass`, confidence 0.85, reasons prefixed `[mock]`.

**16. "How do you stop photo reuse?"** (Elmir)
Every photo's sha256 and 64-bit perceptual hash are compared against every photo ever submitted, across all projects, so recompressing,
resizing or cropping doesn't hide a copy. In the demo the reused framing photo has a fresh EXIF date, on-site GPS and a neutral
filename, so those checks pass, and the hash still matches an Oak Ave photo at distance 4/64. A new photo of the wrong building is what the
inspector's visit catches; capture-time provenance (C2PA) is next.
*Sources:* `packages/verifier/src/checks.ts` (`checkNoDuplicatePhoto`) · `packages/verifier/src/meta.ts` (DCT pHash) ·
`packages/verifier/src/policy.ts` (fail at ≤ 10/64, ≤ 12 for high-risk builders) · `packages/verifier/API.md` (fixture B: 4/64).

## Inspectors

**17. "Who's accountable if an inspector signs off on bad work, or colludes with the builder?"** (Roro)
The builder never picks the inspector: the AI assigns one from the credentialed panel by trade, distance, workload and track record against
the suite, and the platform pays them. Their audit is signed with their own key and attested on-chain by name, and the deterministic checks
still run on the builder's evidence, so a glowing audit can't rescue a reused photo. Milestones of 50,000 RLUSD or more, and every high-risk
builder's milestones, need two independent audits.
*Sources:* `packages/verifier/src/assignInspector.ts` (trade 40 · distance 25 · capacity 20 · agreement 15) · `packages/verifier/src/policy.ts`
and shared `TWO_INSPECTOR_THRESHOLD` (50,000) · `docs/05-api.md` route 10 (must be the assigned inspector) · P2 §7 row 25
([signed audit attestation](https://devnet.xrpl.org/transactions/027F4FE6972AC8C2203E3C44E80E9FEA5E2D785B5AB81CD0CB70C7BE5D516CD3)).

**18. "You say 'seconds', but the inspector still has to visit. What's actually faster?"** (Roro)
Not the visit: we cut everything after it (review, sign-off, wire), which becomes seconds once the suite is green; today funding takes 5–14
business days from request (vendor data). Vendors also say inspections are now the bottleneck, so our inspector files a signed, checklisted
audit from site in our app instead of a PDF. The same interface takes drones and sensors later, which is how the visit itself gets faster.
*Sources:* `docs/01-problem.md` Pain 3 (Built: 5–14 days, inspections the bottleneck; Rabbet: 5.5 vs 9.4 days) ·
`docs/ideas/judge-critique.md` 2g · `docs/02-product.md` (robots roadmap).

## Product, market and regulation

**19. "Isn't this an unregistered securities offering? What about KYC?"** (Bri)
Devnet prototype, not an offer: loan-backed vault shares are securities, so launch is accredited-only (Reg D 506(c)), retail later via
Reg A+ Tier 2, with broker-dealer, lending-licence and BSA/AML work for counsel. KYC is on-ledger: a private vault only accepts deposits from
holders of an **accepted** `KYC_INVESTOR` credential (issued-but-unaccepted or none fails `tecNO_AUTH`, devnet), and shares are
non-transferable. The identity checks behind the credential are mocked and labelled MOCK.
*Sources:* `docs/07-pitch.md` §Regulatory framing · PN §3b · P2 §7 rows 20–23
([not accepted → `tecNO_AUTH`](https://devnet.xrpl.org/transactions/DEB4CB84718EB00336BB30EAAE00DE9C87E6927E3A802E058BE5EFA10E57D2A1),
[no KYC → `tecNO_AUTH`](https://devnet.xrpl.org/transactions/6D17631BB609C7716C145A5F37EB4179D6E75730E9D2C7BA875E31F0505D45DE)) ·
`docs/01-problem.md` §Honest caveats.

**20. "Built already does AI draw review for 169+ lenders. Why you?"** (Bri)
Built proves the need and the AI-review approach, but it's lender-side software: the lender still holds the money and releases it however it
likes, and its investors see nothing. We make the release itself the product: money locked per milestone where it can only pay the builder,
and every check attested publicly before it moves. We're the rail a private-credit fund or community bank plugs into, which is our pilot ask.
*Sources:* `docs/01-problem.md` §Why existing solutions don't close the gap (Built row) · `docs/08-pitch-storyline.md` slide 8 (pilot ask).

## Before stage: what these answers depend on

- **Q19, and slide 6's KYC row:** project vaults are private (`DomainID`) through the ledger adapter (#121) and the CLI `demo` / `prestage`
  (#136), so `tecNO_AUTH` on a project vault can be shown on devnet.
- **Q15:** assumes `VERIFIER_MODE=mock` on stage. Rewrite it if the verifier goes live (or moves to Bedrock).
- Re-open every devnet link the morning of the demo; a devnet reset breaks them all.
