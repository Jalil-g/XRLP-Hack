---
name: Drawproof Finance Workspace
description: Capital in focus. Proof within reach.
colors:
  workspace: "#F5F5EF"
  surface: "#FFFFFF"
  subtle: "#EBEDE5"
  ink: "#17251C"
  secondary: "#59645B"
  divider: "#DDE2D8"
  strong-border: "#8C978C"
  capital: "#17251C"
  capital-text: "#F7F8F2"
  capital-secondary: "#C2CCBE"
  accent: "#D8F36A"
  link: "#285D3C"
  success: "#226442"
  attention: "#805716"
  failure: "#A72E35"
typography:
  financial:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "52px"
    fontWeight: 600
    lineHeight: 1.077
    letterSpacing: "-0.035em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.176
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "10px"
  panel: "16px"
  capital: "20px"
  badge: "6px"
spacing:
  compact: "8px"
  control: "16px"
  panel: "24px"
  section: "32px"
  major: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "8px 16px"
  capital-summary:
    backgroundColor: "{colors.capital}"
    textColor: "{colors.capital-text}"
    rounded: "{rounded.capital}"
    padding: "32px"
---

# Drawproof Finance Workspace

## Overview

Capital in focus. Proof within reach. This implemented system replaces the former Apple/Notion white-and-blue UI. The pinned Ramp/Robinhood/Apple intent means confident finance typography, disciplined working surfaces, and coherent guided tasks—not trading theater. The canonical cross-role brief is `../../docs/ideas/shared-frontend-style.md`; actual shared tokens live in `../styles/drawproof.css`.

## Colors

Warm workspace surrounds white evidence, financial tables, and forms. A near-black green capital summary anchors overview pages. Chartreuse marks the selected milestone's track, the leading segment of a capital bar, and the investment action on dark surfaces; it never means passed. Green, amber, red, and blue remain semantic statuses, always paired with words. Dark metadata uses capital-secondary, never light-surface secondary ink.

## Typography

One local system sans stack. Financial values use tabular numerals, not monospace: 52/56px on desktop, 36/40px on compact screens. Page titles are 34/40px, sections 22/28px, body 16/24px, controls 15/22px, metadata 13/18px. Hashes and addresses alone use mono. Desktop and 1280×720 projector readability are the primary acceptance targets; no remote font dependency.

## Layout

64px shared header, 1200px content inside a 1264px wrapper with 32px gutters. Main content uses 32–48px between task regions. Marketplace is a capital overview followed by a precise project collection with explicit destinations. Portfolio leads with vault share value and a capital bar splitting withdrawable from locked holdings; no fabricated profit line. Project detail links capital summary → labeled milestone rail → checks/evidence plus a compact draw-context column. Builder workspaces foreground the current draw and its next action. Setup and verification narrow to focused form widths, while the demo separates its release/hold story from engineering controls.

Tables become structured lists on compact screens. Wide Schedule of Values is intentionally contained in a labeled scroll region. Projector mode increases base text to 18px without hiding environment or proof. Responsive safeguards remain, but mobile-specific polish was deprioritized by the user.

## Elevation & Depth

White surfaces have a fine divider and at most `0 2px 8px -4px rgb(23 37 28 / .12)`. Review dialogs use the shared overlay shadow and a solid surface. No gradients, glass, glows, or decorative charts.

## Shapes

20px capital panels; 16px working surfaces; 10px controls; 6px semantic tags. Fields have persistent labels and visible boundaries. Controls retain a 44px minimum target. Focus is a green 2px outline with 3px offset; dark summaries use chartreuse focus.

## Components

Primary buttons are dark on light and chartreuse only in capital summaries. Secondary buttons are bordered white. Capital bar (`components/ui/capital-bar.tsx`): a proportional bar of real amounts on the dark summary, every segment named with its amount in the legend; used for raised vs open, released vs escrowed, withdrawable vs locked. Milestone rail (`components/project/milestone-tabs.tsx`), shared by project and builder pages: each stop shows sequence, title, amount and state tag under a 4px status-colored track; the selected stop takes the capital surface with a chartreuse track. Linked on project pages, read-only on the builder page; stacks vertically under 640px. Setup and verification screens use white surfaces, not dark summaries. Checks preserve outcome → signed audit → individual results → attestation, with evidence directly below. Money-location rows use actual ledger snapshots. Unknown balances are not invented.

Investment and other money actions retain enter → review → submit → receipt. Builder evidence retains choose → review → submit → receipt; the receipt survives refreshed milestone transitions. Back keeps drafts. Inspector signatures, evidence-version re-review and software-key semantics remain unchanged. Mock hashes are plain text and never explorer links. Error, empty, loading and pending states explain recovery without presenting skeletons as actual amounts.

Hover/disclosure transitions are 150–200ms. Real money changes may briefly emphasize their location. Reduced motion suppresses nonessential motion; there are no animated balances or fake completion sequences.

## Do's and Don'ts

- Label what each amount represents; escrowed money is not available cash.
- Keep project, milestone, acting identity and environment around consequential actions.
- Preserve review, Back, evidence-version protection, explicit signing and receipts.
- Keep failed or held outcomes unmistakably red/amber even beside chartreuse.
- Do not add fabricated performance, unrelated construction imagery, or autonomous ledger-enforcement claims.
- Do not restore the discarded blue-and-white palette or flatten every region into anonymous sections.
