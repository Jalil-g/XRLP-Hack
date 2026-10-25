# 09 — Launching everyone's agents (direct steps)

> Do this in order. 20 minutes for the whole team. Each person runs their own AI (Claude Code, Codex, Cursor…) in their own git worktree.

## 0. Status at T+0 (done 2026-10-24, nothing to wait for)
- `main` contains all five scaffolds, docs v2 and tickets v2. `pnpm -r typecheck` green in 6 packages; `pnpm -r test` 73 pass / 0 fail.
- `main` is protected against force-push and deletion. PRs merge normally (no required reviews, so the merge train stays fast).
- Devnet money path proven with 41 real transactions: `docs/proof-devnet-2026-10-24.md`.
- Pinned **Checkpoints** issue exists for Sean's CORE-10 reports.
- **Sean's first job is CORE-01 (#53)**, the shared contract v2. It blocks XRPL-10, VER-09, WEB-01 and INS-01, so open that PR within the hour
  and request all four lanes as reviewers. CI + `.env.example` v2 vars are CORE-09 (#61), also his.

## 1. Everyone: one-time setup (5 min)
```bash
git clone https://github.com/Jalil-g/XRLP-Hack && cd XRLP-Hack
pnpm install
cp .env.example .env            # devnet values; never commit .env
# per-person devnet wallets so sequences never collide:
echo "WALLETS_FILE=.data/wallets.<your-github-user>.json" >> .env
```
Read, in this order (15 min, your agent should too): `docs/00-overview.md` → `docs/decisions.md` ("Direction v2") → `docs/02-product.md` →
`docs/03-architecture.md` → `docs/05-api.md` → your lane in `docs/06-tickets.md` → `docs/04-demo-script.md`.

## 2. Everyone: one ticket = one branch = one worktree = one agent run
```bash
git fetch origin && git worktree add ../wt-<TICKET> -b <you>/<TICKET>-<slug> origin/main
cd ../wt-<TICKET> && pnpm install
# start your AI here. Paste the prompt below + the GitHub issue body.
```
Push every ~30 min (`git push -u origin <branch>`). PR into `main` with `Closes #<issue>`, ≤ ~400 lines, typecheck + tests green. Before your
AI session ends: push and leave a `HANDOFF` comment on the issue (template in `docs/06-tickets.md`).

## 3. The agent prompt (paste verbatim, then the issue body)
```
You are working in a pnpm monorepo for a 36-hour hackathon. Read AGENTS.md, then docs/00-overview.md, docs/decisions.md
("Direction v2"), docs/03-architecture.md, docs/05-api.md and your lane's section of docs/06-tickets.md before touching code.
Stay inside <your directory>. Do not edit packages/shared or docs/05-api.md; if you need a contract change, write the exact
interface you want into a GitHub issue comment on the CORE-01 issue (#53) and continue on fakes/mocks.
Devnet only. Never mainnet. Never commit .env, seeds or .data. Every XRPL tx in scripts logs
https://devnet.xrpl.org/transactions/<hash>. TypeScript strict, ESM, Node 24. Run `pnpm --filter <pkg> typecheck && test`
before every commit. Commit + push every ~30 minutes with a clear message. When done, write a HANDOFF comment: branch, last
commit, what works, what's next, gotchas, and a paste-able prompt for the next agent.
Ticket: <paste the GitHub issue body>
```

## 4. Per-person launch order (first three tickets each; all are on GitHub with bodies, labels and assignees)

| Who | Lane | Start now (T+0) | Then (by T+6h) | Then (by T+14h) |
|---|---|---|---|---|
| **Jalil** | `packages/xrpl` | **XRPL-01** #6 and **XRPL-02** #7 spikes (new 3-of-4 list; record `tecCRYPTOCONDITION_ERROR`, `tecNO_LINE`, hashes into `xrpl-protocol-notes.md`) | XRPL-03 #8 bootstrap (adds `releaseService`, `trustee`, 3 inspectors), XRPL-04 #9 cover rates + fees, XRPL-05 #10 new signer list | XRPL-06 #11, XRPL-07 #12, XRPL-08 #13 (fee payment + 3 credentials), XRPL-14 #74, XRPL-12 #17 |
| **Sean** | `packages/core`, `shared` | **CORE-01** #53 contract v2 (open PR within the hour; 4 reviewers), CORE-10 #62 merge train | CORE-02 #54 `evaluateRelease`, CORE-03 #55 workflows (explicit close, stall per milestone), CORE-04 #56 HTTP, CORE-09 #61 CI | CORE-12 #83 release service, CORE-05 #57 adapters on devnet |
| **Elmir** | `packages/verifier` | **VER-01** #19 fixtures with real photos + inspector audits, VER-13 #76 inspector matching | VER-02 #20, VER-03 #21 (incl. `inspector_audit_present`), VER-06 #24 policy, VER-07 #25 `verdictHash` | VER-08 #26 project verification (identity/feasibility/capability), VER-09 #27 adapter, VER-04 #22 Claude checks, VER-10 #28 eval |
| **Bri** | `apps/web` | **WEB-01** #31 API client on routes 1–23 (strip business logic from mocks, "mock" badge), WEB-04 #34 checks panel components | WEB-03 #33 project detail = demo screen, WEB-11 #41 control room | WEB-10 #40 evidence + Run checks, WEB-08 #38 fee → verification report, WEB-09 #39 SoV form, WEB-05 #35, WEB-02 #32, WEB-06 #36 |
| **Roro** | `apps/inspector`, `attest-signer` (rename of `ledger-signer`) | **PITCH-01** #64 (ask rubric, demo length, AWS/Quicknode at booths), **INS-01** #43 scaffold | INS-02 #44 queue, INS-03 #45 audit form | INS-04 #78 signed submission, INS-05 #79 audit history; then take S tickets from others (lightest lane) |

Pitch tickets run alongside (light AI use): PITCH-06 deck (Bri), PITCH-05/07 fact-check + FAQ (Elmir), PITCH-04 submission (Jalil),
PITCH-08 backup video (Roro), PITCH-02/03 script + rehearsals (Sean). DEMO-01 #73 "Ledger says no" = Sean (route 23) + Bri (button).

## 5. Checkpoints (Sean posts a report on a pinned "Checkpoints" issue)
T+1h spikes answered · **T+6h both apps click the whole flow on fakes** · **T+14h same flow on devnet from the UIs** · T+24h feature complete + rehearsal 1 ·
T+28h hardening + backup video · T+32h code freeze (`demo-v1`) · submit ≥ 30 min early.

## 6. If something slips
Cut in this order (never the money shot or the fraud beat): WEB-02 marketplace, WEB-06 invest UI (pre-stage deposits), WEB-07 portfolio,
VER-04 live Claude (mock is deterministic and honest if labelled), INS-06/07, XRPL-08 compliance script (talking point), VER-05, DEMO-01.

## 7. Initial T3 prompt per person (copy the whole block into a new T3 thread on your clone)

`main` already contains all five scaffolds, docs v2 and tickets v2 (merged 2026-10-24; typecheck + 73 tests green). In T3, open a **new thread
in a worktree** for your first ticket (branch `<you>/<TICKET>-<slug>` from `main`), paste your block below, and go. One thread per ticket.

### Jalil — `packages/xrpl`
```
You are my coding agent on Drawproof, a 36-hour XRPL hackathon project (repo already cloned, you are on main or a fresh worktree from main).
Lane: packages/xrpl only (I am @Jalil-g, owner of area:xrpl). Never edit other packages; for contract changes comment on issue #53.
First read, in order: AGENTS.md, docs/00-overview.md, docs/decisions.md ("Direction v2"), docs/03-architecture.md, docs/xrpl-protocol-notes.md,
docs/05-api.md §3 (LedgerPort), the area:xrpl section of docs/06-tickets.md, docs/proof-devnet-2026-10-24.md, packages/xrpl/API.md and src/.
Context: the scaffold already proves the money path on devnet (41 tx) but with the OLD signer list (inspectorA/B w2, aiAgent w1, platform w1),
script-generated escrow conditions, and LoanBrokerSet without cover rates. Direction v2 changes: SignerList = {platform, builder, inspector, trustee}
weight 1, quorum 3; escrow conditions are passed in by core's release service (remove preimage generation from this package's close path);
CoverRateMinimum=10000 + CoverRateLiquidation=100000 + mandatory LoanBrokerCoverDeposit; non-zero LoanOriginationFee/ManagementFeeRate;
new accounts releaseService, trustee, inspector1..3; credentials VERIFIED_BUILDER/VERIFIED_INSPECTOR/KYC_INVESTOR; a builder fee Payment helper;
preflightFinish() before any EscrowFinish (a failed finish with the right fulfillment leaks the preimage).
Work order: XRPL-01 (#6) and XRPL-02 (#7) spikes first (record tx hashes + result codes incl. tecCRYPTOCONDITION_ERROR for a wrong fulfillment
and tecNO_LINE into docs/xrpl-protocol-notes.md §2), then XRPL-03 (#8), XRPL-04 (#9), XRPL-05 (#10). Each ticket = its own branch jalil-g/<ID>-<slug>
+ PR into main with "Closes #N". Use WALLETS_FILE=.data/wallets.jalil.json. Devnet only; never commit .env/.data/seeds. Log every tx as
https://devnet.xrpl.org/transactions/<hash>. Run pnpm --filter @xrlp/xrpl typecheck && test before each commit; push every 30 min.
Before you stop: HANDOFF comment on the issue (branch, last commit, done, next, gotchas, paste-able prompt). Start with XRPL-01 now.
```

### Sean — `packages/core` + `packages/shared`
```
You are my coding agent on Drawproof, a 36-hour XRPL hackathon project (repo cloned; start from main in a fresh worktree).
Lane: packages/core and packages/shared (I am @seanpatrickmay, owner of area:core and the contract). I also run the merge train (CORE-10, #62).
First read, in order: AGENTS.md, docs/00-overview.md, docs/decisions.md ("Direction v2"), docs/02-product.md, docs/03-architecture.md
(§Release = the milestone test suite, §State machines), docs/05-api.md (all of it: routes 1–23, types, ports), the area:core section of
docs/06-tickets.md, packages/core/API.md and src/ (state-machine.ts, quorum.ts, service.ts, conditions.ts, fakes/, ports.ts).
Context: the scaffold implements the OLD model (signer-weight quorum in quorum.ts; FileInspectorKeyring storing fulfillments; autoClose on the
filling deposit; whole project stalls on one refund; withdraw allowed while escrowed). Direction v2: release = evaluateRelease() over a Verdict
(all required checks pass, incl. inspector_audit_present) → core's release service holds preimages and finishes the escrow after preflightFinish;
needs_human → operator decision with signed reason; close is explicit after SubscriptionDate; stall per milestone; withdraw only in Redemption.
Work order: CORE-01 (#53) FIRST — the shared contract v2 PR exactly per docs/05-api.md (SovLine, InspectorAudit, ProjectVerification,
InspectorAssignment, ChecksStatus, ReleasePolicy, Milestone/Project status v2, ChainEvent kinds, ports.ts moved to shared). Open the PR within
the hour and request @Jalil-g @elmir132 @bri-yin @RoroDev2023; additive, typed, tested; nothing else touched. Then CORE-02 (#54) evaluateRelease,
CORE-03 (#55) workflows on fakes with an e2e test = docs/04-demo-script.md, CORE-04 (#56) HTTP server, CORE-12 (#83) release service.
Branch seanpatrickmay/<ID>-<slug>, PR into main "Closes #N", pnpm -r typecheck && pnpm -r test green, push every 30 min, HANDOFF comment
before stopping. Never commit .env/.data. Start with CORE-01 now.
```

### Elmir — `packages/verifier`
```
You are my coding agent on Drawproof, a 36-hour XRPL hackathon project (repo cloned; start from main in a fresh worktree).
Lane: packages/verifier and its fixtures only (I am @elmir132, owner of area:verifier). Contract changes → comment on issue #53.
First read, in order: AGENTS.md, docs/00-overview.md, docs/decisions.md ("Direction v2"), docs/02-product.md (flow steps 2 and 7),
docs/03-architecture.md (§Release = the milestone test suite, §Project verification, §Inspector assignment), docs/05-api.md §3 (VerifierPort),
the area:verifier section of docs/06-tickets.md, packages/verifier/API.md and src/ (checks.ts, policy.ts, verifyMilestone.ts, llm/, meta.ts).
Context: the scaffold has deterministic checks (gps, freshness, pHash dedupe across projects, invoice) and a mock/live Claude judge; mock is
deterministic. Gaps: fixtures are synthetic cartoons named *-reused.jpg (looks staged; live vision will fail the pass case); no verdictHash;
live mode has no timeout/maxRetries and image processing is outside the fail-closed path; no inspector audit input; no project verification
(identity/feasibility/capability); no inspector matching. Direction v2 adds: InspectorAudit as a required input (checks inspector_audit_present,
audit_checklist_complete, audit_matches_evidence), verifyProject() with three sections, assignInspector() scoring a mock panel, policyFor()
per SoV line. Live mode must fail closed: refusal/timeout/corrupt image → needs_human, never pass.
Work order: VER-01 (#19) real photos re-stamped with stampExif + audit fixtures + manifest; VER-13 (#76) assignInspector; then VER-02 (#20),
VER-03 (#21), VER-06 (#24), VER-07 (#25) verdictHash; then VER-08 (#26) verifyProject, VER-09 (#27) adapter, VER-04 (#22), VER-10 (#28).
VERIFIER_MODE=mock must work with no API key. Branch elmir132/<ID>-<slug>, PR into main "Closes #N", pnpm --filter @xrlp/verifier typecheck
&& test green, push every 30 min, HANDOFF comment before stopping. Never commit keys. Start with VER-01 now.
```

### Bri — `apps/web`
```
You are my coding agent on Drawproof, a 36-hour XRPL hackathon project (repo cloned; start from main in a fresh worktree).
Lane: apps/web only (I am @bri-yin, owner of area:web). No business logic in the app; contract changes → comment on issue #53.
First read, in order: AGENTS.md, docs/00-overview.md, docs/decisions.md ("Direction v2"), docs/02-product.md, docs/05-api.md §2 (routes 1–23
and the types), docs/04-demo-script.md, docs/08-pitch-storyline.md §2–3 (slides, demo beats, the GitHub-checks metaphor), the area:web
section of docs/06-tickets.md, apps/web/lib/api.ts, lib/mock-data.ts, app/projects/[id]/page.tsx, components/project/*.
Context: the scaffold UI is good-looking but encodes the OLD model: approvals-panel/escrow-guarantee talk about signer weights and "the AI
as second signer"; mock-data.ts (1,100 lines) holds business logic (platform auto-approves, share price rises on repay, "1,284 indexed photos");
route names don't match docs/05-api.md; the header says "XRPL devnet · live" while on mock. Direction v2: the hero component is a
**Milestone checks panel styled like GitHub checks** (one row per check with reason + attestation link; inspector audit row with signer + tx;
AI verdict row with confidence; outcome banner Released / Failed / Needs human / Pending). Share value rises as interest is repaid (devnet books it at LoanPay, not LoanSet); refunds are
withdrawable from RedemptionDate. Builder onboarding = pay 250 RLUSD fee → verification report (identity / feasibility / capability, MOCK labels).
Create project = Schedule of Values (templates are pre-filled SoVs; evidence + checks per line read-only).
Work order: WEB-01 (#31) API client on routes 1–23 + strip logic from mocks + "mock" badge; WEB-04 (#34) checks panel components with
/dev/checks; then WEB-03 (#33) project detail = the demo screen, WEB-11 (#41) control room (incl. "Platform tries to release" and operator
decision buttons); then WEB-10 (#40), WEB-08 (#38), WEB-09 (#39), WEB-05 (#35). Projector-legible at 1280×720. Branch bri-yin/<ID>-<slug>,
PR into main "Closes #N", pnpm --filter @xrlp/web typecheck green, push every 30 min, HANDOFF comment before stopping. Start with WEB-01 now.
```

### Roro — `apps/inspector` + `packages/attest-signer` (today `ledger-signer`)
```
You are my coding agent on Drawproof, a 36-hour XRPL hackathon project (repo cloned; start from main in a fresh worktree).
Lane: apps/inspector (new Next.js app, port 3001) and packages/ledger-signer, which you will RENAME to packages/attest-signer in INS-04 and strip of all hardware-wallet code (I am @RoroDev2023, owner of area:inspector). No imports from
apps/web (copy the UI kit if needed). Contract changes → comment on issue #53.
First read, in order: AGENTS.md, docs/00-overview.md, docs/decisions.md ("Direction v2"), docs/02-product.md (flow step 7), docs/03-architecture.md
(§Release = the milestone test suite, §Inspector assignment), docs/05-api.md §2 routes 2, 10, 18 and the InspectorAudit / InspectorTask types,
docs/04-demo-script.md beat 3, the area:inspector section of docs/06-tickets.md, packages/ledger-signer/src/ (SoftwareSigner, buildAttestationTx).
Context: Direction v2 means the inspector does NOT hold a release key and there is NO hardware-wallet work (INS v1 tickets #46–#52 are closed).
The inspector is the eyes on site: the app shows assigned audits, a checklist per Schedule-of-Values line (done / partial / not_done + note),
photo upload with EXIF preview, the builder's evidence side by side, and submits a signed InspectorAudit (memo {kind:"audit", milestoneId,
hash: sha256(audit)} signed with the inspector's software key via the SoftwareSigner in that package) to route 10. The AI's test suite then
requires that audit (inspector_audit_present). Until core's HTTP server exists, build against NEXT_PUBLIC_API_MODE=mock with fixtures that
match docs/05-api.md exactly.
Work order: PITCH-01 (#64) is yours too — at the venue ask organizers for rubric, demo length, submission format, and the AWS booth whether
"verifier runs on Bedrock" qualifies; log answers in docs/decisions.md. Code: INS-01 (#43) scaffold + API client, INS-02 (#44) queue,
INS-03 (#45) audit form, INS-04 (#78) signed submission, INS-05 (#79) audit history. Branch rorodev2023/<ID>-<slug>, PR into main
"Closes #N", pnpm --filter @xrlp/inspector typecheck green, push every 30 min, HANDOFF comment before stopping. Start with INS-01 now.
```
