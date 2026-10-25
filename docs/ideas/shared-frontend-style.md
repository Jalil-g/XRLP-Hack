# Drawproof shared frontend direction

Adopted shared direction · 2026-10-25 · applies to investor, builder, inspector, and demo surfaces. Apple/Notion direction and guided steps confirmed by the user.

## Direction

Apple's clarity and restraint; Notion's readable structure and familiar controls. White canvas, one system type family, precise spacing, blue actions, semantic status colors. The goal is an interface that helps users finish the right task with little interpretation.

This extends the existing `apps/web/DESIGN.md` across both apps. It does not replace the product flow or authorize a new visual identity. The user's Apple/Notion preference takes precedence over generic advice to make a design more expressive.

Use Impeccable's Operate mode: familiarity, scanability, consistency, and reliable feedback. Reference: https://github.com/pbakaus/impeccable/tree/936867543ac2576920d663cc9803597f6044f3ac/plugin/skills/impeccable (v4.7.1).

## Ownership and evidence

- Brian: `apps/web`, investor marketplace and portfolio, builder onboarding and evidence, project details/checks, `/demo`. Epic #3; WEB-02 through WEB-12, issues #32–42.
- Roro: `apps/inspector`, queue, audit form, signed submissions, audit history, pre-construction visits, re-audits. Epic #4; issues #43–45, #78–82.
- Elmir: co-assigned to web polish #42 and inspector polish #82.
- Local worktrees: `XRLP-Hack-web01` on WEB-01; `XRLP-Hack-web04` was on `bri-yin/WEB-11-control-room` during this review and contains active edits. No app files were edited for this brief.
- Reviewed the existing product/design guides, both apps' CSS/layout/header implementations, project details, checks panel, investment dialog, inspector queue and audit/signing code. This is a code-based review, not a completed rendered-app audit.

## Shared visual rules

- One Drawproof wordmark and solid 56px header. Show the active role, identity, and data environment consistently. Distinguish Devnet from mock data; a network label alone does not establish that the displayed data is live.
- Content width: 1120px inside an outer 1184px container with 32px desktop gutters. Use 16px mobile gutters. Align header and content edges.
- System sans for everything except hashes and addresses. Titles 28/34px, section headings 20/26px, body 17/26px, supporting copy 15/22px, metadata 13/18px. Use 40/44px display type sparingly. Tabular numerals for financial values.
- White `#ffffff` page; secondary surface `#f5f5f7`; primary text `#1d1d1f`; secondary text `#6e6e73`; separators `#e5e5ea`. Pale text must not carry critical instructions.
- Action blue `#0071e3`; link blue `#0066cc`. Green pass/released, red failed, amber needs review, neutral pending. All states have explicit text; color alone is never the message.
- 8px control radius, 12px panel radius, 6px status-label radius. Flat page content; shadows reserved for overlays. Group related fields using headings, spacing, and separators. A border may enclose a single object such as a checks panel.
- 48px section spacing, 16px heading-to-content spacing, 8px within small groups. Table rows at least 48px and expandable for wrapping. Numbers align right.
- One visually dominant action per current task. Secondary actions remain easy to discover. Main task controls should have 44px touch targets; compact controls must retain usable hit areas.
- 150–200ms transitions for feedback. Honor reduced motion. No loading choreography, pulsing decorative indicators, or simulated progress.

## The interaction rule

At any point users should be able to answer:

1. Which project and milestone am I working on?
2. What has happened, and what does that mean for the money or audit?
3. What should I do next, and why?

Keep the project name, milestone, amount where relevant, and active identity visible near consequential actions. Preserve that context when moving between the web app and inspector app. Keep role-specific navigation concise; the two apps need a shared visual shell, not an identical menu.

Use short, named steps for evidence submission, audit signing, and payments. Show the current step in text; completed steps can be revisited without losing entered information. Keep Back visible and predictable. The final review summarizes the actual submission or payment; its primary button names the consequential action. After success, show a receipt and one clear next destination. A review is not a generic “Are you sure?” dialog layered over the flow.

Put the current task before history and technical detail. Show financial outcomes beside the checks outcome. Keep transaction proof adjacent to the claim it supports, with raw payloads and extended diagnostics behind disclosure controls.

### Investor

Verified projects → project and funding terms → enter amount → review deposit → confirmed deposit and receipt. Explain who is investing, the amount, the project, and withdrawal availability before commitment. Portfolio prioritizes invested amount, current location of funds, and withdrawal timing.

### Builder

Project → current milestone → required evidence → submission → checks and outcome. Show missing evidence next to the upload action. A failed check gives a concrete reason and repair action. If running checks may trigger release, explain that consequence before the action.

### Inspector

Assigned audits → project/milestone → evidence and checklist → review → sign and submit → receipt. The review identifies the inspector, project, milestone, and evidence version. Audit submission is not shown as approval or release of funds. Preserve the existing protection against evidence changing during review; a changed evidence bundle requires an explicit re-review.

### Demo operator

Use the same product shell and components. Sequence controls by the demo script, indicate the current step, and expose prerequisites inline. Separate reset or failure demonstrations from ordinary task actions. Switching roles should preserve the project and milestone rather than require finding them again.

## Preventing avoidable mistakes

- Persistent labels, explicit units, specific verbs. Prefer “Sign and submit audit” to “Submit,” and “Deposit 10,000 RLUSD” to “Confirm.”
- Validate next to the field and retain entered values on errors. Explain an unavailable action beside it rather than relying on a disabled button or hover tooltip.
- Use a concise review before a payment or signature; do not add confirmation dialogs to ordinary navigation, file selection, or every step.
- During submission, prevent duplicate activation and show actual progress. An uncertain transaction result must be reconciled before offering a new payment attempt.
- Use separate states for “Audit submitted,” “Checks passed,” “Release pending,” and “Funds released.” Show release only from confirmed backend/ledger state, not from a green check animation.
- Label stale data with its last successful update. Preserve the last known result; do not imply a green live state while disconnected.
- Empty states explain the next step. Failure messages explain what happened, whether anything changed, and the available recovery.
- Keep keyboard focus visible, return focus after dialogs, announce important asynchronous state changes, and preserve readable contrast. Do not remove essential instructions to achieve a minimal appearance.

## Consistency changes to prioritize

1. Match the inspector app to the web app's system font, white canvas, blue actions, typography scale, solid header, and status-label treatment. Replace purely decorative shadowed containers with sections where appropriate.
2. Standardize header/role/identity/environment display, Button, StatusLabel, Field, PageHeader, Section, EvidenceRow, TransactionLink, and async feedback states. Keep business logic and each app's data access separate.
3. Move the project-level money summary closer to the active milestone/check outcome; currently the reviewed project page places it below loan details, Schedule of Values, and activity.
4. Apply the same plain-language state vocabulary across audit submission, checks, release, errors, and the demo. Preserve inspector evidence-version handling.
5. Treat a shared token file as the first extraction. Reusable UI packaging can follow the existing workspace conventions; do not put styling into `packages/shared`, which owns domain contracts. During any temporary duplication, record one canonical source and compare both copies.

## Avoid

Gradient headlines, translucent/glass headers, neon or glowing indicators, decorative metric tiles, nested card grids, ornamental icons, uppercase eyebrow labels, tiny low-contrast instructions, jargon in primary actions, and animations that imply work has finished before it has.

Use real site evidence where it helps inspection. Do not introduce stock imagery, invented financial numbers, testimonials, or AI mascots as decoration.

## Review criteria

- At 1280×720, a viewer can identify the project, selected milestone, result, and money state without hunting or scrolling through technical sections.
- A new user can identify the next valid action and explain its consequence without coaching. Verify with a quick task walkthrough; visual simplicity alone cannot establish usability.
- At narrow mobile widths, audit fields remain readable, photos retain useful context, actions remain reachable, and the page does not overflow horizontally. Wide data tables may scroll within a clearly indicated region.
- Keyboard-only users can complete the central task. Long project names, missing evidence, failed uploads, stale audits, empty queues, submission failures, and pending transactions have deliberate states.
- A demo handoff from builder to inspector to project outcome retains the same project, milestone, typography, visual hierarchy, and status meanings.

## Confirmed interaction choice

The user selected guided steps with a review before signing or paying. Overview and queue screens remain directly scannable. This brief captures the agreed direction; production implementation and rendered-app validation remain separate work.
