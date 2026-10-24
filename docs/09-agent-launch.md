# 09 — Launching everyone's agents (direct steps)

> Do this in order. 20 minutes for the whole team. Each person runs their own AI (Claude Code, Codex, Cursor…) in their own git worktree.

## 0. Sean first (10 min, unblocks everyone)
1. Merge PR **#75** (`jalil/pitch-review`, docs only, already contains `scaffold/architecture-docs`) into `main`.
2. Merge the code scaffolds into `main` in this order, resolving nothing but `pnpm-lock.yaml` (take `main`'s, re-run `pnpm install`):
   `scaffold/core` → `scaffold/xrpl` → `scaffold/verifier` → `scaffold/web` → `scaffold/ledger-signer`. They touch disjoint directories.
3. Run `pnpm install && pnpm -r typecheck && pnpm -r test` on `main`; fix only what breaks the build; push.
4. Post "main is ready" in chat. Start **CORE-01** (#53) immediately: the shared contract v2 blocks XRPL-10, VER-09, WEB-01, INS-01.

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
| **Roro** | `apps/inspector`, `ledger-signer` | **PITCH-01** #64 (ask rubric, demo length, AWS/Quicknode at booths), **INS-01** #43 scaffold | INS-02 #44 queue, INS-03 #45 audit form | INS-04 #78 signed submission, INS-05 #79 audit history; then take S tickets from others (lightest lane) |

Pitch tickets run alongside (light AI use): PITCH-06 deck (Bri), PITCH-05/07 fact-check + FAQ (Elmir), PITCH-04 submission (Jalil),
PITCH-08 backup video (Roro), PITCH-02/03 script + rehearsals (Sean). DEMO-01 #73 "Ledger says no" = Sean (route 23) + Bri (button).

## 5. Checkpoints (Sean posts a report on a pinned "Checkpoints" issue)
T+1h spikes answered · **T+6h both apps click the whole flow on fakes** · **T+14h same flow on devnet from the UIs** · T+24h feature complete + rehearsal 1 ·
T+28h hardening + backup video · T+32h code freeze (`demo-v1`) · submit ≥ 30 min early.

## 6. If something slips
Cut in this order (never the money shot or the fraud beat): WEB-02 marketplace, WEB-06 invest UI (pre-stage deposits), WEB-07 portfolio,
VER-04 live Claude (mock is deterministic and honest if labelled), INS-06/07, XRPL-08 compliance script (talking point), VER-05, DEMO-01.
