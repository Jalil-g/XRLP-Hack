# Drawproof inspector design

Use the shared direction in `../../docs/ideas/shared-frontend-style.md` and the component rules in `../web/DESIGN.md`. This app is an Operate surface: inspect evidence, record observations, review, sign, and receive a receipt.

## Shared system

`../styles/drawproof.css` is the single source for system fonts, type sizes, colors, spacing-related control tokens, focus, and reduced motion. `app/globals.css` maps existing inspector token names to that theme; do not introduce a separate brand palette. Keep the white canvas, solid header, blue primary actions, semantic status words, and flat sections aligned with the investor/builder app.

## Inspector-specific rules

- Keep the project, milestone, amount, and inspector visible around the review/signing step.
- Preserve the exact evidence bundle the inspector reviewed. A stale bundle still requires re-review.
- Checklist and photo edits remain in place when returning from review.
- Review dialogs trap focus, focus the Back action first, and allow Escape before submission. Pending signatures/submissions cannot be dismissed or sent twice.
- Audit submission, checks passing, and funds being released are distinct outcomes.
- Mock mode is visible at all sizes. Mock receipt/credential hashes are not explorer links.
- Photo galleries become one column on narrow screens; the full evidence remains available. Notes, answers, and consequential controls have visible keyboard focus.
