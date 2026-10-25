---
name: Drawproof Inspector
description: A finance workspace for evidence-led inspection and signed judgment.
colors:
  page: "#F5F5EF"
  surface: "#FFFFFF"
  band: "#EBEDE5"
  ink: "#17251C"
  ink-2: "#59645B"
  line: "#DDE2D8"
  line-2: "#8C978C"
  capital: "#17251C"
  capital-text: "#F7F8F2"
  capital-muted: "#C2CCBE"
  accent: "#D8F36A"
  accent-hover: "#C9E65A"
  action: "#17251C"
  action-hover: "#2B4232"
  link: "#285D3C"
  pass: "#226442"
  pass-bg: "#E7F2E9"
  review: "#805716"
  review-bg: "#FFF2D6"
  fail: "#A72E35"
  fail-bg: "#FBEAEC"
  info: "#285E8C"
  info-bg: "#EAF1F8"
typography:
  display:
    fontSize: "3.25rem"
    lineHeight: "3.5rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
  title:
    fontSize: "2.125rem"
    lineHeight: "2.5rem"
    fontWeight: 600
    letterSpacing: "-0.02em"
  heading:
    fontSize: "1.375rem"
    lineHeight: "1.75rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "1rem"
    lineHeight: "1.5rem"
    fontWeight: 400
  small:
    fontSize: "0.9375rem"
    lineHeight: "1.375rem"
  caption:
    fontSize: "0.8125rem"
    lineHeight: "1.125rem"
rounded:
  control: "10px"
  panel: "16px"
  tag: "6px"
  context: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
  4xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px"
  navigation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    height: "64px"
  status-review:
    backgroundColor: "{colors.review-bg}"
    textColor: "{colors.review}"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  audit-context:
    backgroundColor: "{colors.capital}"
    textColor: "{colors.capital-text}"
    rounded: "{rounded.context}"
    padding: "24px"
---

# Design System: Drawproof Inspector

## Overview

**Creative North Star: "Capital in focus. Proof within reach."**

A serious finance workspace organized around evidence, recorded judgment, review and a durable receipt. Warm canvas, white working panels, dark project context and selective chartreuse connect inspection with the investor and builder experience without turning the queue into an investment dashboard.

This replaces the stale Apple/Notion white-and-blue direction. Approved authority: `../../docs/ideas/shared-frontend-style.md`. Runtime primitives: `../styles/drawproof.css`, with compatibility aliases in `app/globals.css`. Frontmatter records the inspected token snapshot, not a competing stylesheet. Shared tokens and routes are changing concurrently: approved targets below are not a claim of rendered acceptance. Shared CSS owns live values; refresh this snapshot after implementation settles.

**Key Characteristics:**
- Evidence-first working density, not dashboard theater.
- Labeled financial context without decorative capital totals.
- Explicit identity, evidence version and signing consequence.
- Shared primitives with task-specific composition.

## Colors

### Primary
Chartreuse (`accent`) marks selected progress and occasional focal actions on dark surfaces. Dark ink (`action`) is the default primary action on light workspaces; link green supplies inline links and light-surface focus. Chartreuse buttons use dark text.

**The Brand Is Not Outcome Rule.** Chartreuse is not success. Passed, held, failed and pending states always carry words and distinct semantic treatment.

### Neutral
Warm canvas (`page`) separates white working surfaces (`surface`). Quiet insets (`band`), dividers (`line`) and strong input boundaries (`line-2`) support hierarchy. Dark context uses `capital-text` for primary content and `capital-muted` for supporting labels, never light-surface muted text.

### Semantic
Use pass, review, fail and info foreground/background pairs for confirmed success, attention, failure and factual progress. Every state includes text. Missing data reads “Not available,” not a fabricated zero.

## Typography

Use the shared system sans stack for headings, controls and amounts. Mono belongs to hashes, addresses and technical payloads. Financial values use sans with tabular numerals and readable RLUSD units. Right-align comparable numeric columns without discarding supplied precision.

Frontmatter follows the current shared stylesheet. The guide requests financial tracking (-0.035em) and page-title tracking (-0.025em); the inspected shared display/title tokens differ. Resolve that centrally, not with a competing inspector scale. Projector mode now sets the root size (18px), with green supporting ink and stronger dividers; rem-based type and controls scale accordingly. Preserve readable hierarchy rather than restoring the earlier projector size (20px).

**The Labeled Amount Rule.** Every prominent amount names what it measures. Project amount and milestone amount are not balances available to withdraw.

## Layout

The solid desktop header is (64px) at the standard root size. Header, main and footer use an outer maximum (1264px), INCLUDING desktop gutters (32px per side), leaving content (1200px). Do not set the outer maximum to 1200px and then subtract gutters again. Keep brand, active navigation, identity and an honest environment label aligned. On narrow screens retain the separate scrollable labeled navigation row; total header height may grow. Mobile remains supported, but is not a required validation target for this handoff.

Use the frontmatter spacing rhythm: major separation (32–48px), panel padding (16–24px), label/control gap (8px). Task rows typically occupy (52–64px), growing for wrapped content. No nested card stacks.

- **Queue, `/`:** “Assigned audits,” actionable count and compact inspector credentials (name, verification, license and trades). Group prioritized task rows by required work. Preserve refresh, poll freshness, stale/error and empty states. This is a task inbox, never a capital-total hero.
- **Audit, `/audit/[projectId]/[milestoneId]`:** dark project/milestone context with labeled amount, then workflow rail and evidence/report working surfaces. Split evidence/report only at (1280px and above); below that use a linear sequence. Keep the report action predictable and full evidence inspectable.
- **Site visit, `/site-visit/[projectId]`:** project context and a linear question-and-photo workflow through review and submission. Keep each question associated with evidence; do not introduce dashboard metrics. The inspected code still has a large-screen two-column question/photo layout; linear composition remains the approved target to reconcile, without changing workflow guards.
- **History, `/history`:** ordered report entries, receipt/status rows and disclosures, not repeated check-card grids. Existing report containers may remain; individual check results use rows. Preserve identity-scoped results, refresh, stale warnings, report details and release receipts.

Acceptance priority: projector at (1280×720px), then desktop (1440×900px). Check expanded evidence, review dialogs, long names, error paths and visible actions at both sizes. This documentation-only pass does not certify rendered layouts. Shared rem-based gutters may enlarge in projector mode; the (1200px) content calculation above describes standard-root desktop, not a promise of fixed projector content width.

## Elevation & Depth

Warm canvas, white work and dark context provide tonal depth. Working panels are flat with restrained borders. Reserve the shared overlay shadow for dialogs and account popovers, not every report row. Its exact value belongs in the sidecar extensions.

**The Evidence Before Effects Rule.** Motion clarifies real state changes; it never simulates verification or financial completion.

Short feedback (140–200ms) supports hover, focus and disclosure; current controls commonly use (150ms). Reduced motion removes nonessential animation. No count-up balances, fake checks or completion confetti.

## Shapes

Use the frontmatter control, panel, tag and context radii. Compact rectangular tags are not pill navigation. Preserve visible input boundaries and text-bearing statuses. Evidence must use contained sizing rather than cover-cropping; rounded corners cannot remove inspection details.

## Components

### Buttons, fields and navigation
Dark primary buttons sit on light surfaces. Secondary buttons use surface fill and the strong `line-2` border. All sizes, including small, have a minimum target (44px at the standard root size). Keep persistent labels, visible focus, inline errors and retained input. Explain disabled actions nearby. Use the existing Lucide family, not decorative icons on every heading. Keep “Assigned audits” and “Audit history” labeled and active state explicit.

### Evidence and photographs
EvidenceGallery presents single-column, full-frame uncropped photographs with original-file links, filenames, EXIF time, GPS/geofence verdicts, invoices and documents. Missing EXIF is not a passed check; browser-read provenance remains labeled. PhotoPicker is one column when narrow and two from the small breakpoint (640px), with contained uncropped previews, visible remove buttons, hashing/deduplication and reading/error feedback intact.

### Loading and outcomes
`app/loading.tsx` uses `components/ui/loading-state.tsx`: a white status panel, polite live announcement, busy state and decorative aria-hidden skeleton geometry. Client states name the work: inspector credentials, assigned audits, milestone evidence/audit context, and signed reports/receipts. Site-visit loading should remain task-specific without implying a completed report. Loading shapes never resemble financial values. Preserve stale data warnings, validation and empty-state next steps.

### Review, signing and receipts
**The Signature Is Not Release Rule.** An inspector signs a judgment. The platform release service evaluates the milestone suite separately; audit submitted, checks passed, release pending and funds released are distinct states.

Complete → review → sign and submit → receipt. Review names project, milestone, amount/unit, inspector identity, evidence version, observations, photos and consequence. Back preserves the draft; changing evidence invalidates the reviewed version and requires re-review. Keep every existing validation, stale-bundle, key/identity and duplicate-submit guard.

Native review dialogs contain focus, initially focus Back, support Escape and focus restoration before submission, and prevent dismissal or repeat submission while busy. Preserve both browser-key signing and the explicitly labeled core-signing fallback; never claim one when the other occurred. Final actions say “Sign and submit audit” or the truthful fallback, never “Release funds.” Receipts stay durable and distinguish mock examples from genuine Devnet transaction links. Mock hashes are not explorer links; Live API alone does not establish ledger or verifier mode.

## Do's and Don'ts

### Do:
- Do keep task count and credentials above the queue, without capital totals.
- Do label amounts, retain RLUSD units and preserve domain precision.
- Do show full uncropped evidence with provenance and original-file access.
- Do preserve review/back, evidence-version checks, signing guards and durable receipts.
- Do prioritize 1280×720 projector and 1440×900 desktop acceptance.
- Do reconcile this token snapshot with shared CSS after concurrent work settles.

### Don't:
- Don't restore blue-primary actions or the stale white-everywhere direction.
- Don't invent metrics, site photographs, release claims or Devnet connectivity.
- Don't use chartreuse as success, white text on chartreuse, or light-surface muted text on dark context.
- Don't replace history rows with repeated check-card grids or crop inspection photographs.
- Don't add gradients, glass, neon, fake checks or financial-completion theater.
- Don't weaken validation, stale-evidence, signing-key, identity or duplicate-submit protections.
