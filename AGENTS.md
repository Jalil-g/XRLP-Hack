# AGENTS.md — read this first (all AI tools: Claude Code, Codex, Cursor, Copilot, Gemini)

We are 5 people, each with their own AI, building one XRPL Lending-track hackathon project in 36 hours
(AI & Fintech XRPL Hackathon NYC, Oct 24–25 2026).

## What we're building

A construction-lending marketplace: verified builders list projects, investors pool RLUSD into an XRPL
Vault, the Lending Protocol lends to a per-project account, and each milestone's money sits in an XRPL
escrow released only after an AI evidence check + a human inspector sign off.

Read in order: `docs/01-problem.md` → `docs/02-product.md` → `docs/03-architecture.md` →
`docs/04-demo-script.md` → `docs/decisions.md`.

## Repo layout & ownership

| Path | Owns | Notes |
|---|---|---|
| `packages/shared` | everyone (PR only) | Domain types + state machine. **The contract.** Don't change shapes casually. |
| `packages/xrpl` | XRPL owner | All ledger transactions + devnet scripts |
| `packages/verifier` | AI owner | Claude-based evidence verification; must work in `VERIFIER_MODE=mock` |
| `packages/core` | backend owner | Workflow orchestration + JSON store |
| `apps/web` | frontend owner | Next.js UI + route handlers |
| `docs/` | everyone | Ideas go in `docs/ideas/<short-name>.md` (one file per idea → no merge conflicts) |

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
- Only the person adding a dependency touches `pnpm-lock.yaml`; on conflict, take `main`'s and re-run `pnpm install`.
- Log decisions (and anything you decided on your own) in `docs/decisions.md`.
- Personal AI preferences (language, tone, commit rules) belong in your personal config, not this file.
