# Web workspace design

The user's 2026-10-25 request for a full frontend redesign supersedes the earlier Apple/Notion direction. The canonical design and interaction rules are in [the shared frontend guide](../../docs/ideas/shared-frontend-style.md).

This app covers the investor marketplace, portfolio, builder workflows, project checks and finance, and the control room. Keep data access through `lib/api.ts`; preserve validation, error recovery, existing deep links, and actual money-state semantics.

Use the shared workspace shell and tokens. Keep the main decision visible, and put supporting technical detail in dedicated views or disclosures. The investment and released-milestone animations share `FundsTransfer`; process feedback and the verification scene reflect actual API states.
