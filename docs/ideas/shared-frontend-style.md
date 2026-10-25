# Drawproof workspace design

Adopted 2026-10-25 at the user's request to redesign the entire frontend, reduce information overload, and make important processes more expressive. This supersedes the earlier Apple/Notion visual direction.

## Visual system

- A charcoal navigation rail, warm off-white workspace, white task surfaces, and a pale lime navigation accent. Forest green actions; semantic green/red/amber for outcomes.
- System sans with compact 15px body text, 12px supporting text, and 32px page titles. Tabular financial values. Generous spacing around the current task, rather than a marketing hero.
- Shared tokens: `apps/styles/drawproof.css`. Shared shell, document motion, and surface styles: `apps/styles/workspace.css`. App-specific motion/layout remains in its app.
- Architectural, code-native illustrations are labeled as concepts; they never imply photos of an actual property. Financial transfer scenes use dimensional wallet/vault forms and curved token paths.
- Responsive navigation becomes a compact horizontal row on mobile. Forms, dialogs, and financial values must remain usable at 320px. Preserve keyboard focus and touch targets.

## Information hierarchy

- Projects: compact marketplace with type/search/funding filters and a small set of meaningful values per project.
- Project detail: Overview, Milestones, Financials, and Activity are separate URL-addressable views. Existing `?m=` links still open the correct milestone.
- Milestone checks: signed-audit context and failures stay visible. The rest of the suite and model/proof metadata expand on demand.
- Portfolio: position summaries and relevant redemption actions. Never imply that redemption-phase value guarantees liquid funds.
- Builder: one selected project at a time. New projects use details → budget/milestones → documents/review. Evidence submission has an explicit pending state and receipt.
- Inspector: actionable queue, evidence review → audit report → signing review, then receipt. Preserve draft data, signature checks, evidence version binding, and re-audit protections.
- Control room: clear scene actions; explanations and engineering controls expand on demand.

## Motion and truth

- Show state-driven motion for funding, milestone checks/releases, verification, evidence upload, project creation, and signed audit submission.
- Pending animation is indeterminate. Never fabricate progress, partial balances, an attestation, or a payment. Confirmation requires the corresponding successful API result; a passing verdict alone does not prove release.
- Transfer arrivals replay briefly even for immediate responses, without delaying the actual result or making the user wait to dismiss it. No loop continues indefinitely after success.
- Respect `prefers-reduced-motion`: keep status and account information; remove travel, scan, orbit, and arrival motion.
- Pause project auto-refresh while a consequential dialog/receipt is open, then refresh on dismissal. This protects receipts when the action changes the parent project's status.
- Mock mode stays visible. Mock transaction identifiers never masquerade as live explorer proof. Devnet only; do not alter ledger or signing contracts for presentation.
