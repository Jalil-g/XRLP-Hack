# Frontend remediation plan (web + inspector)

Status: proposed, 2026-10-25. This replaces the copy and layout rules in `shared-frontend-style.md` wherever the two disagree.

## Why PR #194 still reads as AI

1. **It explains itself.** The two apps hold about 90 sentence-length strings in total, about 60 in web and 30 in the inspector.
   - Nearly every heading, banner and state has a grey line that describes the mechanism ("…only if every required check passes", "Saved evidence remains on record…").
   - The UI narrates instead of showing.
2. **The palette is a known default.** Cream `#f5f5ef`, a green-black slab and an acid chartreuse accent appear on the frontend-design skill's list of things generated sites converge on.
   - Ramp and Robinhood do use lime with black, but on a white canvas with true black. Our tinted versions are the "AI" variant.
3. **Every page uses the same template.** Each page has:
   - a title with a grey subline
   - a dark slab with a giant number
   - a row of cards
   - a table inside a bordered card

   Nothing tells you which page you are on.
4. **The same facts repeat.** On the builder page, 36,000 appears four times and "Ready for checks" appears three times. "This draw" repeats the milestone, amount and destination already shown in the rail.
5. **Template chrome.** Meta strings joined with ` · ` everywhere, "View →", pills on every row.
6. **Plumbing is on stage.** Tx hashes, `signer ryxZJ9…`, `credential 2B865F9B…`, "Signed by core, on your behalf", CancelAfter, LoanPay and tecNO_AUTH all appear in the main view.
7. **No moment.** The product's one dramatic event is money leaving escrow because the proof passed. Today it is rendered as rows in a table changing icon.

## Rules (testable)

- **R1 No explainer lines.** Nothing goes under a page title, section heading, banner or card title. `PageHeader.description`, `CardDescription` and banner `sub` lines are removed from the components, not just left empty.
- **R2 Copy exists only where it changes a decision.** That means:
  - errors: what failed and how to fix it, one line
  - empty states: one line plus an action
  - the confirmation before a money move
- **R3 Labels are three words or fewer; buttons are a verb plus an object.** The next step lives on the button ("Release 36,000", "Upload evidence", "Sign audit"), never in a sentence.
- **R4 One hero number and one primary action per screen.** Everything else is quieter.
- **R5 Show state with form, not prose.** Use the rail position, a filled bar, a check ticking green, the disabled reason on hover.
- **R6 Proof on demand.** Hashes, signer, credentials and explorer links go into a "Proof" disclosure or the receipt. Each one is still one click away, so the demo can still show the ledger.
- **R7 No ` · ` meta strings, no `→` on links, no pill unless the state differs between rows.**

The lint gate is a `scripts/copy-lint` grep. It runs in CI for both apps and fails on:
- `description=` or `CardDescription` in a page
- any JSX text node of 12 or more words outside `errors`, `empty`, `confirm` or the legal footer

## Visual direction (one move, everything else quiet)

- **Canvas:**
  - white `#ffffff` with a neutral grey ground `#f6f6f6` only for page chrome
  - true ink `#0a0a0a`
  - neutral greys (no green tint)
- **Lime** (`#d8f36a`, or a brighter `#c8f169`) appears in exactly two places: money that has moved to the builder, and the primary button. Nowhere else.
- **State colours** keep their current semantics (pass, fail, review).
- **Type:**
  - one family, kept as the system SF stack
  - a real scale: 64/40/24/17/14
  - numbers in tabular figures, with heavy weight on the hero number only
- **No dark slabs.** The hero number sits on the canvas, the way Robinhood shows the account value.
- **Fewer containers.** Lists are hairline rows. Cards are kept only for the checks suite and dialogs.
- **Signature move: the release.** When checks run, the rows resolve one by one (this exists). On the last pass:
  - the escrow amount counts down
  - "Paid to builder" counts up
  - the capital bar fills with lime

  This is one orchestrated motion of about 1.2 s and respects reduced motion. It is the clip judges remember.
- **Optional, only if the data is real:** a stepped "released over time" line on the project page, one step per released milestone. The timestamps come from the release tx; no step is invented.

## Screen-by-screen cuts

| Screen | Remove | Replace with |
|---|---|---|
| Marketplace | Tagline paragraph, "Explore projects" card, `4 verified · RLUSD`, `View →`, "Verified builder" on every row | Hero number "366,000 RLUSD raised", then plain rows that are whole-row links |
| Project | Grey "Pays … only if every required check passes", the "This draw" sidebar, the SoV `aside` | Banner "10 checks" plus the button "Run checks"; the destination and amount live on the button and in the confirmation |
| Project, checks rows | Signer address, audit-signer hashes inline | Name plus a status; hashes go in Proof |
| Builder | STEP sentences ("The inspector signed the audit. Run the checks…"), "Saved evidence remains on record…", the duplicate "Milestone 1: Foundation · 36,000" heading, the licence and credential string | Rail, then the current milestone's single action button; "17 files" opens the receipt |
| New project | "A clear plan for the work…", "Each line becomes part of a milestone escrow…" | Title "New project"; locked fields show a lock icon whose tooltip says "Set by template" |
| Verification | Fee note, summary description | Status, then the fee button, then results |
| Portfolio | Explainer and empty copy beyond one line | Hero "Your positions" value, then rows |
| Demo control room | Every `body=` paragraph | Step titles and buttons only; the presenter script lives in `docs/04-demo-script.md` |
| Inspector queue | Task `hint` sentences, the empty-state AI explanation | The row's action button ("Audit", "Re-audit", "Visit site") |
| Inspector audit | `CardDescription`s, "The AI runs the test suite…", the signing-panel paragraph | Checklist; the note field appears only when the answer is "No" or "Unsure"; "Sign audit" |
| Inspector site visit | "Answer each question; explain anything that is not a clear yes.", the escalation paragraph | Same progressive note field; title "Site visit" |
| Footers | Long prototype disclaimer | "Devnet prototype. Not an offer to invest." (legal; stays) |

## Process

1. **Copy kill pass, about 1 h, mechanical, both apps.**
   - Apply R1 to R3 and R7.
   - Add the copy-lint gate.
   - Every removed string is listed in the PR, so nothing that carried a decision is lost silently.
2. **Two comps before code, about 45 min.**
   - Build two self-contained HTML comps of the project page at 1280×720 in the direction above. One keeps the rail on top; the other uses a left milestone list.
   - The user picks one. The rest of the build follows that choice.
3. **Build, about 3 h.** Order: project page, builder, marketplace, portfolio, then the inspector queue, audit and site visit. Delete the dark slab, the `.project-context` panel and "This draw".
4. **The release moment, about 1 h.** Count-down, count-up and the bar fill. The motion is verified on video with `preview_recording`.
5. **Verification.**
   - The existing flows: deposit, evidence, audit, site visit and review → back → receipt.
   - Overflow at 390, 768 and 1280.
   - Builds and tests.
   - **Five-second test:** a fresh agent with no repo context gets each 1280×720 screenshot and answers "what is this page and what would you press?". If it cannot answer from the UI alone, the screen fails.
   - **Independent critique** using impeccable `critique` + `distill`, briefed only with the rules above.

## Skills used

- **impeccable** (installed for Codex at `~/.codex/skills/impeccable`; not yet visible to Claude Code):
  - `distill` and `clarify` for the cut pass
  - `quieter` for the slab and pills
  - `bolder` for the release moment
  - `critique` and `polish` for review
- **frontend-design** (Anthropic official plugin, not installed): its "AI default" list drives the palette and chrome changes above.
- **dataviz** (available): the capital bar and the optional release-over-time chart.

## Ownership

`apps/inspector` is Roro's lane. The inspector copy cuts touch only strings and layout, not signing or attestation logic. Ping Roro on the PR before it merges.
