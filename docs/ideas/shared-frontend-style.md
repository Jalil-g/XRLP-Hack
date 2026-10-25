# Drawproof — finance workspace design system

> Superseded on 2026-10-25 by the user's explicit selection of **Elmir's redesign** in `design/drawproof-ui` (PR #204). Use that source for the live apps: paper `#F7F7F5`, ink/actions `#2F4241`, white panels with `#E3E4E0` borders and 6px corners, regular-weight headings, and role-specific card/table layouts. Preserve live API, signing, session, and transaction behavior. Do not reintroduce the dark capital slabs, oversized financial heroes, or chartreuse brand direction documented below. This document is retained as historical context; see the latest entry in `docs/decisions.md` and issue #205.

2026-10-25 · Canonical direction for `apps/web` and `apps/inspector`.

This replaces the earlier Apple/Notion white-and-blue polish. The user explicitly requested a more impressive finance platform, referencing Ramp, Robinhood, and Apple. Preserve the existing product and review flows; replace the visual hierarchy, compositions, and component treatment. This is a redesign, not a palette swap.

## The point of view

**Capital in focus. Proof within reach.** Drawproof should feel like a serious financial product with the confidence to be memorable. Warm off-white workspaces, precise near-black typography, a dark capital summary, and a sharp chartreuse accent create a recognizable system. Large, beautifully aligned amounts make the stakes tangible. Evidence and transaction receipts make the confidence earned.

Reference intent (not a claim of a current live-site audit):

- [Ramp](https://ramp.com): disciplined workspace navigation, useful density, clear financial hierarchy. Borrow the prioritization, not its logo or exact screens.
- [Robinhood](https://robinhood.com): confident financial typography, strong contrast, selective vivid color. Borrow immediacy; never add trading theater, fabricated charts, or urgency.
- [Apple](https://www.apple.com): careful spacing, concise copy, coherent interactions and immaculate detail. Borrow craft, not giant marketing whitespace in a working form.

One system owns the screen. Do not combine a Robinhood hero, Notion table, and unrelated SaaS sidebar. The visual signature is **a dark money summary above a light, precise working surface**, connected by a labeled milestone rail. It must work on project details, a portfolio, and an inspector audit without turning each page into the same dashboard.

## Product commitments

Drawproof finances construction projects. A signed inspector audit and automated/AI checks inform the platform release service; the ledger constrains where escrow funds go. An audit signature alone does not release money. Preserve API contracts, evidence-version protections, monetary validation, signing, and transaction reconciliation.

Show project, milestone, active identity and environment around consequential actions. Distinguish mock data from Devnet connectivity. Never invent yield history, customers, performance, site photographs, or claims of autonomous ledger enforcement. Use actual API/fixture data and label mocks. A value that is unavailable is “Not available,” not zero.

## Palette and semantic tokens

| Purpose | Value | Usage |
| --- | --- | --- |
| Workspace | `#F5F5EF` | Warm page canvas; avoid pure white everywhere |
| Surface | `#FFFFFF` | Working tables, forms, evidence and receipts |
| Subtle surface | `#EBEDE5` | Quiet inset regions and hover |
| Ink | `#17251C` | Main text and default primary buttons |
| Secondary ink | `#59645B` | Supporting text on light backgrounds |
| Divider | `#DDE2D8` | Section rules and panel boundaries |
| Strong border | `#8C978C` | Inputs and necessary boundaries |
| Capital surface | `#17251C` | One dominant financial summary per overview |
| Capital text | `#F7F8F2` | Amounts and labels on dark surfaces |
| Capital secondary | `#C2CCBE` | Supporting dark-surface text |
| Brand accent | `#D8F36A` | Selected progress, one focal action on dark, small brand moments |
| Accent hover | `#C9E65A` | Hover on accent buttons |
| Link / focus | `#285D3C` | Underlined inline links; strong light-surface focus |
| Success | `#226442` / `#E7F2E9` | Confirmed passed/released status |
| Attention | `#805716` / `#FFF2D6` | Review, expiry, missing requirements |
| Failure | `#A72E35` / `#FBEAEC` | Failed checks, failed submissions |
| Information | `#285E8C` / `#EAF1F8` | In progress and factual notices |

Chartreuse is a brand color, **not a success signal**. Use dark text on it, never white. Default primary buttons are dark on light pages; chartreuse buttons belong on dark surfaces. A hold remains unmistakably amber/red regardless of surrounding brand color. Every status has words and, when useful, a consistent icon. Verify contrast in the rendered states, including disabled, focus, hover, and dark summary metadata.

Canonical implementation: `apps/styles/drawproof.css`. Both apps consume it. Keep inspector compatibility aliases where useful; do not copy competing token sets. No styling in domain-contract `packages/shared`.

## Typography and rhythm

Use one reliable system sans stack (SF Pro/Segoe UI/Roboto), with intentional weight and scale. No remote font dependency needed. Mono is reserved for hashes, addresses, and technical payloads; financial values use the sans with tabular numerals.

| Role | Desktop | Mobile | Weight |
| --- | --- | --- | --- |
| Main financial amount | 52/56px | 36/40px | 550–600 |
| Page title | 34/40px | 28/34px | 600 |
| Section title | 22/28px | 20/26px | 600 |
| Body / form text | 16/24px | 16/24px | 400 |
| Controls / table body | 15/22px | 15/22px | 450–500 |
| Supporting metadata | 13/18px | 13/18px | 400–500 |

Use -0.035em tracking for display amounts, -0.025em for page titles, normal tracking for body. No blanket uppercase navigation or tracked eyebrows. Currency units sit beside amounts at a smaller but readable size. Right-align comparable numeric columns and preserve decimal precision supplied by the domain. Display large values responsively without truncating their meaning.

Spacing: 4, 8, 12, 16, 24, 32, 48, 64px. Use 32–48px between major regions, 16–24px within panels, 8px between label and control. Dense information belongs in orderly rows; breathing room belongs around the decision.

## Shell and component language

- Shared 64px solid header, existing Drawproof wordmark, concise role-specific navigation, clear active state. Identity/role controls and an honest environment label occupy the same positions across both apps. Avoid adding a sidebar solely to look like fintech.
- Align header and main content to a 1200px maximum content width, 32px desktop and 16px mobile gutters. Working forms can narrow to 760px; detail pages may use an approximately 2:1 content/context split.
- On mobile keep the brand/account row compact and put navigation in a separate scrollable row. Never hide core destinations inside an unlabeled icon.
- Panels: 16px radius; financial summary may use 20px. Controls: 10px; badges: 6px. Borders and a very light single shadow may distinguish white surfaces from the warm canvas. No nested card stacks.
- Buttons: 44px minimum target, solid fill, precise label, small consistent icon only when it explains the action. Secondary: white/surface with visible border. Quiet: text with clear hover. One dominant action per active task region.
- Fields: persistent labels, 44–48px controls, visible boundaries, inline help/errors. Errors retain all input. Avoid floating labels and placeholder-only instruction.
- Tables: 52–64px rows, quiet headings, thin separators, intentional numeric alignment. Click targets are explicit; do not nest links inside a full-row overlay. On narrow screens turn project/queue rows into structured lists; reserve horizontal scrolling for inherently wide financial schedules.
- Dialogs: concise title, persistent project context, readable summary, Back and an explicitly named final action. Focus containment, Escape, focus restoration, keyboard operation, and scroll handling must work.
- Icons: one existing icon family, 18–20px, consistent stroke. Use for navigation, file type, status, and meaningful actions. Do not put an icon in every heading.

## Compose each screen for its task

### Marketplace

Open with a compact page title and one sentence about verified construction financing. The project collection is the main content, not a giant generic slogan. Give each project a clear name/location, amount raised against principal, rate with its existing meaning, funding state and an explicit destination. A featured project is allowed only with an honest selection rule; do not invent “recommended” or “best return.” Use a strong typography-led lead region and a precise project list rather than a grid of interchangeable metric cards.

### Project detail — the flagship screen

First viewport: breadcrumb/name and state; a dark capital summary with the actual relevant amount, funding/escrow context and valid next action; then a labeled milestone rail leading into the current milestone. Pair the checks/evidence working area with a compact money-and-next-step context column. At 1280×720 the viewer should understand project, milestone, outcome, and financial consequence. Put history, Schedule of Values, and raw payloads below the main task or inside clear disclosures.

The money summary must label what its amount means. “In escrow” is not “Available to withdraw.” Show amounts in separate labeled rows where multiple locations matter. A chart is justified only by real comparable data; otherwise use a labeled proportional funding bar or money-location diagram.

### Portfolio

Lead with the user's actual invested amount and available/locked context. Follow with holdings and their next relevant dates/actions. Avoid invented profit lines, sparkline ornaments, or percent-change badges. Empty portfolios get a useful path to projects, not a wall of zeros.

### Builder

Lead with the active project and next required action. Use a milestone rail and a generous upload/evidence working surface. Requirements remain visible before file selection. Distinguish selected, uploading, submitted, checks pending, and failed evidence. Successful submission keeps a durable receipt or confirmation visible even when refreshed data changes the surrounding page.

### Inspector queue and audit

Queue: “Assigned audits,” actionable task count, compact inspector credentials, and prioritized rows grouped by required work. This is an inbox for judgment, not an investor dashboard; never put decorative capital totals here.

Audit: project/milestone context at top, evidence at useful inspection size, checklist in a clean working surface, and review action in a predictable location. On wide screens evidence and the current checklist may sit side by side. On mobile use a linear sequence. Keep evidence version and signing identity in the review. Changing evidence invalidates the review exactly as the domain requires. History uses the same receipt and status language.

### Verification, onboarding, site visits, and demo

Carry the same typography, surfaces, controls and state vocabulary to every route, including loading/error/empty states and developer checks gallery. Use focused forms for setup and verification, not oversized dashboard panels.

The demo control room follows the canonical 100-second recording story: one release, one hold. A visible current step and project/milestone context guide the operator. Keep reset and engineering controls separate. In projector mode enlarge the evidence, outcome and money; remove low-value chrome, not essential disclosures. Do not change the six-slide pitch or transaction story as part of this redesign.

## Review before commitment

Evidence: choose → review → submit → receipt. Payments: enter/select → review → pay → receipt. Audits/site visits: complete → review → sign and submit → receipt.

Back preserves the draft. The review names project, milestone, amount/unit or evidence version, acting identity, and consequence. The final button names the action (“Deposit 10,000 RLUSD”, “Sign and submit audit”). Signing an audit must never be labeled “Release funds.” Keep distinct states for audit submitted, checks passed, release pending and funds released. Explain blocked actions beside them. Reconcile an uncertain payment result before offering retry.

## Motion and finish

Use 140–200ms transitions for hover, disclosure and focus feedback. A real outcome change can receive one brief emphasis. Reduced motion removes nonessential animation. No staged fake checks, count-up balances, pulsing live dots, confetti, entry choreography, or animations that imply financial completion early. Skeletons follow final content geometry and never resemble actual financial values.

## What makes this professional rather than template-generated

- Compose around the decision and the actual data, not three equal KPI tiles followed by a generic chart.
- Create contrast through one dominant amount, deliberate surfaces and controlled density. Do not make everything a hero.
- No purple/blue gradient backgrounds, glass panels, ambient blobs, neon glows, oversized pill navigation, or repeated icon-card grids.
- No arbitrary left-border accents or meaningless badges. No status communicated only by color.
- Use genuine evidence images where available; never decorate projects with unrelated stock buildings or AI site photos.
- Do not add fake metrics, fabricated activity, aspirational claims or new marketing copy to fill space.
- Avoid flattening everything into anonymous white sections. Panels, contrast and selective depth are useful when they express real hierarchy.
- Polish long names, wrapped labels, aligned amounts, empty states, receipts, pending states, validation and failure paths as carefully as the ideal screenshot.

## Acceptance and agent handoff

Implementation must visibly replace the old composition, not merely recolor existing classes. Preserve working behavior and both apps' data adapters. Read app AGENTS.md and Next.js version-specific docs. Use Impeccable new-work with this user-selected familiar finance direction; its layout/typeset/harden/polish references are focused passes, not permission to change the product.

1. Establish shared tokens and primitives before app-specific compositions. Update both app DESIGN.md files and `.impeccable/design.json` to the actual built system; retire conflicting Apple/Notion instructions.
2. Inventory every route in both apps. Check 390px mobile, 768px tablet, and 1280×720 / 1440×900 desktop. No unintended page overflow or obscured task actions.
3. Exercise investment review/back/receipt, builder evidence review/back/receipt, inspector audit review/back/signature, stale evidence protection, a released milestone and a held milestone. Verify focus and errors, not just screenshots.
4. Use the collaborative preview first. Capture real rendered screens and review composition, density, contrast and continuity between roles. Run relevant typechecks, tests and builds.
5. Obtain an independent visual reviewer verdict against this guide. Resolve material findings and recapture. Passing tests alone does not establish design quality.
6. Commit/push checkpoints; open a PR with screenshots, route coverage, test evidence and honest limitations. Do not merge automatically.

The pitch deck's existing timing and storyline stay authoritative. Its older Apple/Notion palette is historical; any future deck visual revision should use this palette and typographic hierarchy without changing slide content or timing.
