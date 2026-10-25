# AGENTS.md — read this first (all AI tools: Claude Code, Codex, Cursor, Copilot, Gemini)

We are 5 people, each with their own AI, building one XRPL Lending-track hackathon project in 36 hours
(AI & Fintech XRPL Hackathon NYC, Oct 24–25 2026).

## What we're building

**Drawproof**: a construction-lending marketplace. Builders pay to have a project verified (AI-first), investors pool RLUSD into
an XRPL Vault per project, the Lending Protocol lends to a per-project multisig account, and each milestone's money sits in an
XRPL escrow released only when the milestone's **test suite** passes: a licensed inspector's signed audit + the AI's checks.

Read in order: `docs/00-overview.md` → `docs/decisions.md` (**Direction v2**) → `docs/02-product.md` → `docs/03-architecture.md` →
`docs/05-api.md` → your lane in `docs/06-tickets.md` → `docs/08-pitch-storyline.md` (canonical six-slide, three-minute pitch) → `docs/04-demo-script.md` (100-second recording).
Deck production: `docs/ideas/pitch-3min-style-guide.md` + `docs/ideas/pitch-3min-claude-prompts.md`.
Shared visual direction for Brian and Roro: `docs/ideas/shared-frontend-style.md`. Launch steps: `docs/09-agent-launch.md`.

## Repo layout & ownership

| Path | Owner | Epic | Notes |
|---|---|---|---|
| `packages/xrpl` | @Jalil-g | #1 | All ledger transactions, devnet bootstrap/demo, real LedgerPort adapter |
| `packages/verifier` | @elmir132 | #2 | AI evidence checks; must work in `VERIFIER_MODE=mock`; real VerifierPort adapter |
| `apps/web` | @bri-yin | #3 | Investor/builder UI + `/demo` control room; data only via `lib/api.ts` |
| `apps/inspector`, `packages/attest-signer` | @RoroDev2023 | #4 | Inspector app: queue, audit form, **signed audit submission** with a software key. No release keys, no hardware wallet |
| `packages/core`, `packages/shared`, root config | @seanpatrickmay | #5 | Orchestrator, HTTP routes, integration. `shared` = **the contract** → PR reviewed by Sean |
| `docs/` | everyone | — | Ideas go in `docs/ideas/<short-name>.md` (one file per idea → no merge conflicts) |

Tickets: `docs/06-tickets.md` is the draft; **GitHub Issues are the source of truth**. Contracts: `docs/05-api.md`.

**Stay inside your directory.** If you need a change in someone else's package, open an issue or PR.

## Commands

```bash
pnpm install          # once, at repo root
pnpm -r typecheck     # all packages
pnpm -r test          # all packages
pnpm --filter @xrlp/web dev
pnpm --filter @xrlp/xrpl demo   # full devnet money flow
```

## Rules for agents

- **Devnet only.** Never mainnet. Never testnet for Vault/Loan (not enabled there).
- **Never commit secrets.** `.env` is gitignored; add new vars to `.env.example` with a fake value.
  Devnet seeds go in `.env` or `.data/` (gitignored) — the repo is **public**.
- TypeScript strict, ESM, Node 24, pnpm. No new top-level tools without a note in `docs/decisions.md`.
- Every XRPL tx in the demo must log an explorer link: `https://devnet.xrpl.org/transactions/<hash>`.
- Branch per task: `<name>/<short-task>`; PR into `main`; keep PRs small; rebase often.
- **Commit + push early and often** — at least every ~30 min or at every working checkpoint, even WIP
  (`git push -u origin <branch>`). Laptops die and AI sessions hit limits; unpushed work doesn't exist.
- **Handoffs:** before your AI session ends or hits a usage limit, push your branch and comment on the
  GitHub Issue: what's done, what's next, gotchas. Anyone's agent should be able to resume from that.
- Pick up work from GitHub Issues (one owner per issue; assign yourself before starting).
- Only the person adding a dependency touches `pnpm-lock.yaml`; on conflict, take `main`'s and re-run `pnpm install`.
- Log decisions (and anything you decided on your own) in `docs/decisions.md`.
- Personal AI preferences (language, tone, commit rules) belong in your personal config, not this file.
