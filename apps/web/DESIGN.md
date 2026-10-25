# Design

Drawproof web. Bar: Apple's and Notion's web design, played straight (user decision 2026-10-24). Operate surfaces:
familiar controls, quiet chrome, exact type. Color is reserved for state. Tokens live in `app/globals.css`.

## Type

- One family: the system UI face (`-apple-system`, SF Pro on the demo Mac; Segoe UI / Roboto elsewhere). Mono only for
  hashes, addresses and amounts in tx detail: `ui-monospace` (SF Mono).
- Roles (fixed rem, ratio ≈ 1.2): `display` 40/44 600 −0.025em · `title` 28/34 600 −0.02em · `heading` 20/26 600 −0.01em ·
  `body` 17/26 400 (Apple's body size; projector-legible) · `small` 15/22 · `caption` 13/18 secondary.
- Numbers are tabular (`tabular` utility). Headings `text-wrap: balance`, prose `text-wrap: pretty`.
- No uppercase tracked labels, no eyebrows above headings.

## Color

| Role | Token | Value |
|---|---|---|
| Page | `--color-page` | `#ffffff` |
| Band (secondary surface, table header, hover) | `--color-band` | `#f5f5f7` |
| Ink | `--color-ink` | `#1d1d1f` |
| Secondary text | `--color-ink-2` | `#6e6e73` |
| Icons, disabled (not for text: 3.6:1) | `--color-ink-3` | `#86868b` |
| Hairline | `--color-line` | `#e5e5ea` |
| Strong rule / input border | `--color-line-2` | `#d2d2d7` |
| Action (buttons, links, focus) | `--color-action` | `#0071e3` |
| Pass / released | `--color-pass` | `#1a7f37` on `#e6f4ea` |
| Fail | `--color-fail` | `#cf222e` on `#fdecea` |
| Needs review / expired | `--color-review` | `#8a5a00` on `#fdf3d7` |
| Pending / neutral tag | `--color-neutral` | `#57606a` on `#f0f0f2` |
| Info tag (in progress) | `--color-info` | `#0b5cad` on `#e8f1fb` |

Blue means "you can act". Green / red / amber mean a verdict and always come with a word ("Released", "Failed").

## Shape and depth

- Radius: 8px controls, 12px panels, 6px tags. Full pill only for the segmented role control.
- No shadows on page content. Only overlays (dialog, toast) get a soft offset shadow.
- Group with space and 1px hairlines, not boxes. A panel border is allowed where a region is one object (the checks panel).
  Never nest bordered panels.

## Layout

- Content column 1120px max, 32px gutters. Header 56px, white, hairline bottom, not translucent.
- Notion-style properties: label column 160px in secondary text, value in ink.
- Tables: band-colored header row, hairline row separators, 48px rows, numbers right-aligned.
- Vertical rhythm: 48px between sections, 16px heading → content, 8px inside groups.

## Components

- `Button`: primary (action blue fill), secondary (band fill, ink text), quiet (text only). 36px / 44px. One primary per screen.
- `Tag`: Notion-style soft chip, 13px medium, tinted background + dark text, no border, no dot.
- `ChecksPanel` (`components/checks/`): GitHub checks. `OutcomeBanner` (Released / Failed / Needs review / Ready / Waiting / Expired) → `AuditRow` (inspector's signed audit, always first) → `CheckRow`s (failures first; flagged photos inline) → `VerdictRow` (decision, confidence, attestation). Review every state at `/dev/checks`.
- `TxLink`: mono short hash + ↗ to devnet explorer; in mock mode plain text with "mock" title, never a link.

## Motion

150–200ms ease-out on hover/press and on state changes. One authored moment: after "Run checks" every row shows running, then rows resolve top to bottom 110ms apart (skipped under `prefers-reduced-motion`). The reveal starts only when real results arrive; it never stands in for progress.
No page-load choreography, no pulsing dots.

## Don't

Gradients, glass/blur, glowing dots, hero metric tiles, icon-plus-heading card grids, eyebrow labels, colored side borders,
emoji, decorative icons, dark mode for the projector.
