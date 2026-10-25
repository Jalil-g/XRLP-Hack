# Drawproof: three-minute pitch direction

2026-10-25 · Six slides · Apple/Notion visual direction · Companion: `pitch-3min-claude-prompts.md`.

## Adopted structure

Use the adopted six-slide structure in [the canonical storyline](../08-pitch-storyline.md). It gives the product demonstration enough time. Keep the old story's spine: the funding problem, a verification-to-payment mechanism, one successful release, one blocked milestone, and a credible business ask.

The proposed timing uses the entire slot before the close: 4 × 20 seconds + 100 seconds = 180 seconds. Reduce the introduction and avoid repeating the mechanism on slides 3 and 4. Target 170 seconds, leaving 10 seconds for transitions or a slow start. This assumes the three minutes covers the pitch, with questions afterward; the final slide can remain displayed during Q&A.

| Slide | Purpose | Time | Running clock |
| --- | --- | ---: | --- |
| 1 | Drawproof and the promise | 8 s | 0:00–0:08 |
| 2 | Real failure and the gap we address | 22 s | 0:08–0:30 |
| 3 | What AI, the inspector, and XRPL each do | 15 s | 0:30–0:45 |
| 4 | One clear workflow diagram | 15 s | 0:45–1:00 |
| 5 | Recorded demonstration | 100 s | 1:00–2:40 |
| 6 | Business, pilot ask, thanks | 10 s | 2:40–2:50 |
| — | Timing reserve; not a slide | 10 s | 2:50–3:00 |

Do not spend 20 seconds listing team members. Introduce the team as Drawproof, then make the problem concrete. Use the final slide for a pilot ask, not only “Thank you.” Keep fee percentages, regulatory routes, roadmap, and detailed trust-model tables for spoken Q&A rather than adding slides to the six-slide deck.

## Story and factual boundaries

The Nightingale/CrowdStreet example already anchors the pitch docs. Keep it, with a primary source: DOJ says more than 800 investors sent approximately $62.8 million, and the sponsor diverted funds. Use this as motivation for accountability in real-estate funding. It was investment fraud, not a demonstration of a construction draw failing. Do not imply Drawproof would have prevented the entire case.

Primary source: [DOJ, May 20, 2025](https://www.justice.gov/usao-ndga/pr/head-commercial-real-estate-investment-firm-sentenced-federal-prison-628-million-fraud).

An optional alternative already in `docs/01-problem.md` is the Houston builder who submitted false invoices to construction lenders. It is closer to the evidence-review use case, but use one example, not both. [DOJ, May 14, 2025](https://www.justice.gov/usao-sdtx/pr/houston-custom-home-builder-heads-prison-misusing-construction-funds). If selecting that alternative, replace slide 2 and its notes together; do not mix its restitution amount with Nightingale's funds raised.

Position the gap as **our focus: connecting milestone evidence, review decisions, and payment records**. Do not claim nobody else does AI draw review: the repo identifies existing vendors and on-chain prior art. Avoid the older line “we built the lender where that's impossible.”

Explain **XRP Ledger / XRPL**, rather than broadly saying “XRP.” The product uses native vaults, lending, escrows, and attestations. The recorded prototype uses the network and asset mode actually shown; the docs describe Devnet and a mock RLUSD IOU, not production RLUSD.

Three distinct contributions:

- AI: consistency review across evidence and the audit. Describe implemented capabilities separately from what the recorded run demonstrates.
- Inspector: signed site audit, required by the platform's check suite.
- XRPL: vault/lending infrastructure, milestone escrow constraints, and public transaction records.

The ledger fixes an existing escrow's destination and cancellation conditions. The platform's release service holds the secret and decides when to release. Do not draw an AI verdict as an on-ledger escrow condition. Do not claim end-to-end custody protection before the money reaches milestone escrow: the newer Q&A documents the broker's borrower-selection discretion.

The latest reviewed `docs/pitch-qa.md` and verifier API docs say live vision has not yet been demonstrated and the default demo uses mock AI judgments. Record the actual mode visibly. If a verified live run is available by recording time, update that label and narration from the recording evidence. Duplicate-photo detection is deterministic; it must not be narrated as the model's reasoning. Never invent model findings or replace mock labels with “live.”

## Slide style

The slides and frontend should belong to the same product. Slides use larger type and fewer objects; they do not imitate an app dashboard.

- **Canvas:** widescreen 16:9, 13.333 × 7.5 inches; white `#FFFFFF` throughout. No alternating themes.
- **Margins:** 0.70 inches left/right, 0.55 inches top/bottom. Titles begin at the same position on slides 2–4. Use generous space between groups.
- **Typeface:** Aptos throughout, regular and semibold. If unavailable, use Arial throughout the entire deck. Do not mix fallback fonts or use SF Pro unless it is installed on every playback machine.
- **Sizes:** cover wordmark 48 pt; slide titles 40 pt; main text 26 pt; diagram labels 24 pt; supporting labels 20 pt; sources/disclosures 16 pt minimum. Slide 2's central number may use 72 pt. Cut copy before shrinking it.
- **Palette:** primary `#1D1D1F`; secondary `#6E6E73`; blue emphasis `#0071E3`; rules `#D2D2D7`. Green `#1A7F37` and red `#CF222E` only for pass/release and fail/hold. Every color-coded state has a text label.
- **Wordmark:** use an approved Drawproof logo asset if supplied; otherwise use the exact text “Drawproof” in Aptos semibold. Do not invent a new icon or borrow Apple/Notion logos.
- **Composition:** one main idea per slide. Prefer plain text, one strong statistic, and one native diagram. No dashboard tiles, rounded card grids, icon circles, gradients, glass, heavy shadows, stock crypto imagery, decorative buildings, or fake product screenshots.
- **Diagrams:** editable text and straight connectors, clear arrowheads, no crossing lines. Use consistent line weights around 1.5 pt. Labels sit near their connections. The workflow diagram is conceptual, not a ledger architecture diagram.
- **Content:** sentence case, specific verbs, no buzzwords or long bullets. Approximately 15–35 main on-screen words per slide; diagram labels and necessary disclosures can exceed this slightly. Put the spoken story in notes.
- **Sources:** slide 2 shows “Source: U.S. DOJ · May 20, 2025”; put the full source URL in notes. Evidence captions and mock/Devnet labels remain visible where they affect interpretation.
- **Motion:** use simple cuts. No staggered builds or Morph dependencies. The video is the main motion in the deck.
- **Consistency method:** establish the theme and master once; use the same typography, coordinates, and palette for all six slides. Claude should edit the requested slide only and preserve the other slides.

## Recorded demo: 1 minute 40 seconds

Recommended delivery: a local silent MP4 with live narration and short readable captions. This keeps the presenter in the room and avoids dependence on venue audio. If the team prefers prerecorded narration, bake it into the same file and remove simultaneous live narration. The storyboard and timing remain the same.

| Video clock | What viewers see | What it proves |
| --- | --- | --- |
| 0:00–0:10 | One named project, selected milestone, funded/escrowed state | Orient the audience |
| 0:10–0:30 | Evidence and inspector audit; review then sign if that path is implemented | A named human contributes a signed audit |
| 0:30–0:50 | Checks with readable reasons; one actual AI consistency finding if validated, otherwise clearly labeled mock judgment | Explain the difference between rules and model judgments |
| 0:50–1:10 | Confirmed successful release, actual amount, builder outcome, real transaction receipt | The payment happened in the recorded run |
| 1:10–1:30 | Second milestone's reused-photo failure and still-locked money | A required failing check blocks the platform release flow |
| 1:30–1:40 | Hold on the blocked outcome and a readable evidence reason | Leave viewers with a clear result |

Do not include a full onboarding journey, repayment, keeper loop, or every protocol primitive in this 100-second video. Omit the “Ledger says no” beat: an invalid secret rejection does not prove the ledger understands the AI verdict. Do not show a new guided flow as shipped until it exists in the recorded app.

Use the same project names and milestone labels across screens and captions. Record actual application behavior, with consistent viewport/zoom across both frontends. Keep the project, check reason, outcome, and amount readable. Capture at 1920×1080 if possible; frame only the relevant content. Cut waits and label the video “Edited for time”; never fake a result or imply edited elapsed time is a measured performance benchmark.

Label the video “Recorded demo” and show the actual environment/model mode. Existing mock registry labels must remain visible. If a displayed transaction is a mock fixture, do not label it as a real Devnet transaction or link it to an explorer. Narrate actual amounts from the recording; no placeholder amount may remain in the final deck.

Embed the video file locally, keep an independent local copy, and rehearse in the exact PowerPoint slideshow environment. If the Claude extension cannot embed/configure video or speaker notes, it should leave a clearly identified placeholder and report the required manual step. Do not assume its capabilities. No internet streaming dependency.

## Source hierarchy and corrections

Reviewed against the local `origin/main` snapshot `7c2fb37`:

- `docs/08-pitch-storyline.md`: story arc, eight-slide plan, demo beats.
- `docs/07-pitch.md`: why XRPL, business model, original hook.
- `docs/01-problem.md`: problem evidence and competitors.
- `docs/pitch-qa.md`: newer disclosures about release timing, broker discretion, mock AI, and demo claims.
- `packages/verifier/API.md`: implemented modes and unvalidated live vision.
- `docs/ideas/shared-frontend-style.md`: agreed visual direction and guided-step preference.

Where sources conflict, use the newer technical disclosures and actual recorded behavior. Some old storyline details are stale: audit/verdict attestations are described there as AccountSet; current architecture uses memo-bearing Payment transactions. Show human-readable “Audit record” / “Verification record” on the slides and put exact technical details in Q&A only after confirming them.

## Handoff checks

Exactly six slides. Total planned delivery 2:50 including the 1:40 recording. One font and one white theme. No unsupported claims, invented team biographies, invented logo, or simulated video evidence. Readable on a projector. Native editable diagram. Sources in notes. Real/mock status disclosed. Rehearse the full deck twice, including starting and ending the video. If running long, cut spoken setup; preserve successful release and failed-check proof.
