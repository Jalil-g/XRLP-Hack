# Drawproof: prompts for Claude in PowerPoint

Production specification for the [canonical storyline](../08-pitch-storyline.md). Use with [the style guide](pitch-3min-style-guide.md). These prompts create a six-slide pitch, not a finished video. No video or approved logo asset was supplied during planning.

Paste the master prompt first. Then paste slides 1–6 in order in the same conversation. If starting a new conversation, paste the master again. Finish with the consistency prompt. The approved copy and notes below are self-contained; Claude does not need access to the repository.

## Master prompt — paste first

```text
Help me build exactly six slides for Drawproof, a construction-finance prototype on the XRP Ledger. The pitch slot is 3 minutes. Planned content is 2:50, leaving 10 seconds spare. Slides 1–4 take 60 seconds total; slide 5 contains a 100-second recorded demo; slide 6 takes 10 seconds.

Use the same calm Apple/Notion-inspired visual system throughout. This is a professional pitch, not a marketing template or app dashboard. Establish these settings once, using the theme/master if your tools support it:

16:9; 13.333 × 7.5 inches; white #FFFFFF background on every slide.
Margins: 0.70 inches left/right, 0.55 inches top/bottom.
Font: Aptos, regular and semibold. If unavailable, choose Arial for the ENTIRE deck before designing. Never mix fallback families.
Cover wordmark 48 pt; slide titles 40 pt; body 26 pt; diagram labels 24 pt; supporting copy 20 pt; source/disclosure 16 pt minimum. Slide 2's single statistic can be 72 pt.
Text #1D1D1F; secondary #6E6E73; restrained blue #0071E3; rules #D2D2D7. Green #1A7F37 means passed/released; red #CF222E means failed/held. Always label states in words.
Titles on slides 2–4: x=0.70, y=0.55, w=11.93, h=1.05 inches. Start body content below y=1.85. Match left alignment across slides. Footnotes sit above the bottom 0.55-inch margin.
Use an approved Drawproof logo only if I supply it. Otherwise use a simple text wordmark “Drawproof.” Do not create a new logo icon.
No gradients, glass, decorative icons, stock construction/crypto imagery, glowing shapes, card grids, fake screenshots, extra slides, or automatic design-theme changes. Use native editable text and connectors for the requested workflow diagram. No fancy transitions.
Preserve exact approved copy; do not add facts or rewrite claims to sound stronger. Put narration in speaker notes, not on the canvas. If tools cannot write notes, provide the note text separately. If text does not fit, adjust line breaks or spacing before reducing font sizes. Do not silently omit disclosures.

Product truth:
Drawproof links construction milestone evidence, a signed inspector audit, checks, and payment records. AI reviews evidence consistency. Rules do checks such as duplicate-photo detection. The inspector's signed audit is a required input. XRPL provides native vault/lending infrastructure and milestone escrows with fixed destinations. The PLATFORM release service controls release timing; the ledger does not read the AI verdict. Never say fraud is impossible, AI is trustless, all capital is protected end-to-end, or the product is mainnet-ready.
The last reviewed repo docs describe mock AI judgments in the demo and unvalidated live vision. Do not claim a live model run unless I provide a recording proving one. Label the actual recorded mode. Mock RLUSD on Devnet is not production RLUSD. No fake transaction hashes, invented amounts, or fabricated evidence.

Create slides one at a time when I send each prompt. Edit only that numbered slide, and preserve all other slides. Follow this master even when a later prompt is short. If a required media file is missing, leave a clearly marked placeholder and report it instead of inventing content. Do not claim the video is embedded or playable unless you have actually done it.
```

## Slide 1 — introduction · 8 seconds

```text
Create slide 1 using the established Drawproof master.

Composition: a restrained title slide with a large text wordmark aligned left at x=0.70, y=1.65. Under it, place the main line in a generous two-line text area, 36 pt, with clear breathing room. No illustration, team headshots, team biographies, or extra slogan. Use the same wordmark on the closing slide.

Exact on-slide copy:
Drawproof
Construction money should move only when the building does
XRPL Devnet prototype

The last line is a modest 20 pt disclosure near the bottom-left. If the full main line needs two lines, break after “move”.

Speaker notes, 8 seconds:
“We're team Drawproof. We connect construction funding to verified progress, one milestone at a time.”
```

## Slide 2 — problem and gap · 22 seconds

```text
Create slide 2 only. Keep the established font, white canvas, margins, and title position.

Exact title:
When project funds lose accountability

One strong statistic, not a statistics grid:
$62.8M

Place that number in 72 pt charcoal on the left below the title. Alongside it, use this exact explanation, 26 pt, with sensible line breaks:
Raised in the Nightingale / CrowdStreet fraud

Below, separated by generous whitespace rather than a box, place:
Our focus: evidence → review → payment

Visible source, 16 pt:
Source: U.S. DOJ · May 20, 2025

Do not add “lost” after the dollar amount: the figure is funds raised. Do not say Drawproof could have prevented this entire case. Do not add construction-delay statistics, market-size figures, competitor logos, or “no competitors” claims.

Speaker notes, 22 seconds:
“In the Nightingale case, more than eight hundred investors put in sixty-two point eight million dollars. The sponsor diverted the money. Drawproof focuses on a specific gap: connecting milestone evidence, review decisions, and payments so investors can see what happened.”

Source URL in speaker notes:
https://www.justice.gov/usao-ndga/pr/head-commercial-real-estate-investment-firm-sentenced-federal-prison-628-million-fraud

Source context in notes: This was real-estate investment fraud. It motivates accountability; it is not proof that the prototype eliminates investment fraud or protects money before milestone escrows exist.
```

## Slide 3 — the solution and why AI/XRPL · 15 seconds

```text
Create slide 3 only, matching the master. This slide explains responsibilities; do not repeat the workflow diagram from slide 4.

Exact title:
Verification tied to payment

Use three plain horizontal rows with consistent alignment. Left label column about 2 inches wide, right explanation column about 9 inches. No enclosing cards or icons. Labels 26 pt semibold; explanations 26 pt regular. Separate rows with whitespace, optionally very light rules.

Exact row copy:
AI — Reviews evidence consistency
Inspector — Signs the site audit
XRP Ledger — Records proof and fixes escrow destinations

Exact bottom clarification, 20 pt:
Our platform controls release timing

Speaker notes, 15 seconds:
“AI reviews evidence consistency. The inspector signs the site audit. XRP Ledger records proof and fixes escrow destinations. Our platform releases funds after the required checks pass.”

Additional note for Q&A: Duplicate-photo matching is deterministic. The recorded run must disclose whether model judgments are mock or live. An AI pass alone does not authorize payment.
```

## Slide 4 — workflow diagram · 15 seconds

```text
Create slide 4 only using the master. Build a clean, native, EDITABLE diagram using text and straight connectors. It must be readable from the back of the room. Do not generate a bitmap, use SmartArt styling, or introduce a card grid.

Exact title:
How a milestone gets paid

Place four equal-width stages in a single left-to-right row below the title. Use 24 pt semibold stage labels and 20 pt supporting lines. Put subtle blue numbers 1–4 above the labels. Connect the stages with horizontal gray arrows in the gaps, not through text. Suggested label block width 2.4 inches with approximately 0.75 inches between block starts beyond that width; ensure the last block stays inside the right margin.

Exact stage labels and supporting copy:
1. Fund the project
   XRPL vault + loan
2. Lock each milestone
   Funds in escrow
3. Review the evidence
   Signed audit + checks
4. Release or hold
   Pass: pay builder
   Fail: funds stay locked

Under the fourth stage, use green only for “Pass: pay builder” and red only for “Fail: funds stay locked.” Include the words, not just colored dots. Do not draw a direct investor-to-builder payment arrow bypassing review.

One bottom clarification, 20 pt:
Platform checks decide when · Escrow fixes where funds can go

Speaker notes, 15 seconds:
“Investors fund a verified project. The loan funds milestone escrows. Evidence and a signed site audit feed the checks. Our release service pays the builder when required checks pass; otherwise funds stay locked.”

Notes only: This diagram summarizes the user journey. The exact money path is vault → loan → project account → milestone escrows → builder. It does not imply the ledger evaluates the check results or that loan close and escrow creation are fully atomic.
```

## Slide 5 — recorded demo · 100 seconds

```text
Create slide 5 only, matching the same white theme and typography. This slide is reserved for a 100-second real screen recording, with live narration by default.

Use a slim 28 pt top title:
Drawproof in action

Place a centered 16:9 media region approximately x=1.38, y=1.10, w=10.57, h=5.95 inches. Preserve the video's aspect ratio. Do not crop away its project name, results, amounts, or environment labels. No laptop mockup, browser illustration, decorative frame, or fake screenshots.

Visible small caption near the title:
Recorded demo · Edited for time

If I supply a video, embed the local file if your tools support it and set it to play once in slideshow mode. Keep its recorded environment and real/mock labels readable. Do not label it “Live.” If there is no file, create a plain placeholder reading “Insert 1:40 demo recording” inside the media region, and tell me that it must be replaced before presenting. Do not generate a pretend demo.

Speaker notes: add the cue sheet below. These lines must match the actual recorded behavior and amounts; remove or correct any line the video does not substantiate. Use the mock-judgment wording unless a validated live run is supplied.

0:00–0:10 — Project and locked funds
“This is our demo project. Investor funds have been placed in milestone escrows. We're following one milestone from evidence to payment.”

0:10–0:30 — Inspector contribution
“The builder submits evidence. The inspector reviews the site checklist and signs an audit for this project and milestone. That audit becomes a required input to the checks.”

0:30–0:50 — Checks and AI disclosure
Default, if model judgments are mock:
“The suite combines deterministic checks with AI consistency review. In this recording, model judgments are mocked and labeled; the rules and signed-audit checks still run. The live model path is implemented but not demonstrated here.”
Alternative ONLY if the supplied video demonstrates a validated live model finding:
“The suite combines deterministic checks with a live AI consistency review. Here is the model's finding and the evidence it references. The inspector's signed audit remains a required input.”

0:50–1:10 — Payment proof
“The required checks pass. Our release service finishes the escrow, and the payment goes to the fixed builder address. This receipt shows the transaction from the recorded run.”
If transaction data is mock, replace the last sentence with: “This is a simulated payment result, labeled as mock.” Never claim a real receipt from fixture data.

1:10–1:30 — Failed check
“Now a second milestone reuses a photo from another project. The duplicate check fails. The reason is visible, and the funds remain locked. A failed required check blocks our release flow.”

1:30–1:40 — Hold on result
“The audit, evidence, and payment record stay connected. Investors can see the outcome and the reason behind it.”

Keep these as notes, not paragraphs over the video. The video itself should use short captions only. Do not insert a fake model answer, a fake transaction, or an artificial result animation to match the script.
```

## Slide 6 — close and questions · 10 seconds

```text
Create slide 6 only using the same Drawproof wordmark and white master. Keep the closing slide visible for questions. Do not introduce a new visual theme.

Exact on-slide copy, in this hierarchy:
Drawproof
Pilot with one construction lender
Verification, origination, and management fees
Thank you. Questions?
Devnet prototype · Not an offer to invest

Use the wordmark at 36 pt; the pilot ask at 40 pt as the main statement; the revenue line at 24 pt; thanks/questions at 26 pt; the disclosure at 16 pt near the bottom. Use generous whitespace. No pricing table, invented contact details, invented customer logos, or extra roadmap.

Speaker notes, 10 seconds:
“We earn verification, origination, and management fees. We're looking for one construction-lending pilot. Thank you.”

If I later supply a verified demo/repository URL, it may be added as one quiet text link or tested QR code. Do not invent a URL or QR code now.
```

## Final consistency prompt

```text
Review the six-slide Drawproof deck against the master instructions. Preserve the approved story, exact financial units, and factual qualifications. Do not add slides.

Check: 16:9 white canvas throughout; one font family; repeated title alignment; consistent wordmark; readable body and disclosure sizes; no text overflow, clipped connectors, or unsupported visual decoration. The workflow diagram must be editable. Read each slide at slideshow scale, not only in editing view.

Confirm the narration plan is 8 + 22 + 15 + 15 + 100 + 10 = 170 seconds, with 10 seconds reserve. Report that this is a timing plan, not a measured rehearsal, unless an actual rehearsal was performed. Do not count narration over the video twice.

Check that slide 2 identifies $62.8M as funds raised, uses the DOJ citation, and does not imply the prototype prevents the entire Nightingale case. Check that slide 3 distinguishes AI, inspector, and ledger roles, and that slide 4 says the platform decides release timing.

Check that slide 5 is called recorded, not live. Report whether a real video is embedded or still missing. Check its duration and actual playback if tools permit; otherwise list the manual playback check. Preserve real/mock and Devnet disclosures. Never infer that a UI showing green proves a live model call or a validated ledger transaction.

List any remaining manual steps briefly outside the slides. Do not hide missing media, invent evidence, or say you tested PowerPoint playback unless you did. Do not add authoring instructions to the audience-facing slides.
```
