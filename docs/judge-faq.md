# Judge FAQ: five mandatory questions (PITCH-07)

Use this card for the five questions every presenter must be able to answer. Lead with the **bold sentence**; it is the complete answer if
the judge interrupts. The rest is the mechanism and the honest limit. Longer edge cases remain in `docs/pitch-qa.md` and
`docs/07-pitch.md`.

Never say **trustless AI**, **ledger-enforced release**, **mainnet-ready**, or that inspectors or hardware wallets hold release keys.

## 1. "The AI is your oracle?"

**The AI is one input to a published test suite, not a sole authority, and uncertainty keeps the money locked.** Deterministic checks cover
GPS, timestamps, duplicate-photo hashes and invoice totals; a signed audit from the assigned inspector is mandatory. Any required failure
fails the milestone, while low confidence, refusal, timeout or model error becomes `needs_human` for a named operator's signed decision.
The platform runs this policy off-ledger and attests the result on-chain before release; Smart Escrows enforcing it on-ledger are roadmap.

- Evidence: `packages/verifier/src/verifyMilestone.ts`, `packages/verifier/src/policy.ts`, `docs/03-architecture.md` §Release.

## 2. "The platform holds the release key?"

**Yes: the demo release service holds each escrow's preimage, but that key can release only to the builder fixed when the escrow was
created.** It cannot redirect a live escrow; if release never happens, the escrow can return to the project account after expiry. The suite
controls *when* the platform submits a finish, and its verdict is attested before that transaction. A compromised service could release
early to the correct builder, so we disclose that trust and post first-loss cover; moving the release rule on-ledger needs Smart Escrows.

- Evidence: `docs/03-architecture.md` §Escrow gating, `packages/core/src/release-service.ts`, `docs/08-pitch-storyline.md` slide 6.

## 3. "Why not a hardware wallet?"

**A hardware wallet would protect an inspector's audit-signing key, but it would not remove the platform release-service trust described
above.** In direction v2 the inspector signs an attestation, not an escrow release, and the demo deliberately uses a labelled software
signer in the browser. The signer interface can take a hardware-backed implementation later; it is security hardening, not a different
release guarantee. We did not integrate or test a hardware wallet in this build.

- Evidence: `docs/decisions.md` Direction v2, `docs/03-architecture.md` software components, `packages/attest-signer/`.

## 4. "How do inspectors get hired?"

**Drawproof does not claim an automated hiring marketplace: the demo starts with a mock, pre-vetted panel, and production onboarding is an
operational step before assignment.** A production operator would verify licence, identity, insurance and service region before issuing a
`VERIFIED_INSPECTOR` credential. For each project, the builder cannot choose the inspector: Drawproof deterministically ranks eligible panel
members by Schedule-of-Values trade coverage, distance, current load and prior agreement with the suite. Unverified and explicitly
unavailable candidates are excluded; if too few eligible inspectors remain, terms do not lock. Large or high-risk milestones require two
independent audits.

- Evidence: `packages/shared/src/domain.ts` (`Inspector`), `packages/verifier/src/assignInspector.ts`, `packages/verifier/src/policy.ts`.
- Do not claim: that real licence/insurance registry onboarding is implemented. The demo panel and scheduling/history data are mock-labelled.

## 5. "What about skyscrapers?"

**The system does not template a skyscraper; it turns that project's own Schedule of Values into milestone-specific test suites.** The SoV
is already the construction draw's budget breakdown: each line carries its amount, trade and evidence requirements, and the verifier creates
policy per line without allowing one line to weaken another. Residential templates are only pre-filled SoVs. The demo proves the mechanism
on a duplex, not skyscraper-scale operations, so multi-inspector logistics and enterprise integrations remain production work.

- Evidence: `docs/02-product.md` steps 3–4, `packages/verifier/src/policy.ts`, `packages/verifier/API.md` §Policy isolation.

## Ten-second fallback

"The ledger fixes where the money can go. Our disclosed release service decides when, using deterministic checks, an assigned inspector's
signed audit and bounded AI judgement. The inspector panel is mock-vetted today, hardware signing is future hardening, and each project's
own Schedule of Values makes the same pipeline fit larger builds."
