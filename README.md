# Drawproof

**Construction money that moves only when the building does.**
A construction-lending marketplace on the XRP Ledger: investors fund verified projects through a native XRPL Vault, the Lending
Protocol lends to a project account no single party controls, and each milestone's RLUSD sits in an escrow that releases only when the
milestone's **test suite** passes (a licensed inspector's signed audit + the AI's checks over the builder's evidence).

XRPL Lending & Borrowing track · AI & Fintech XRPL Hackathon NYC, Oct 24–25 2026 · **devnet prototype, not an offer to invest.**

→ **Full project page (pitch, guarantees, devnet proofs, team): [`docs/submission/README.md`](docs/submission/README.md)**

## Run it locally

Node ≥ 22 (we use 24) and pnpm 10.

```bash
git clone https://github.com/Jalil-g/XRLP-Hack && cd XRLP-Hack
pnpm install
cp .env.example .env                    # fake ledger + mock verifier by default; .env is gitignored
```

Start the three processes (one terminal each):

```bash
pnpm --filter @xrlp/core serve                                                    # :4000 core API (LEDGER_MODE=fake)
NEXT_PUBLIC_API_MODE=http CORE_URL=http://localhost:4000 pnpm --filter @xrlp/web dev        # :3000 website
NEXT_PUBLIC_API_MODE=http CORE_URL=http://localhost:4000 pnpm --filter @xrlp/inspector dev  # :3001 inspector app
```

Load the Maple St demo data (also resets it):

```bash
curl -X POST localhost:4000/api/admin/demo/reset -H 'content-type: application/json' -d '{"seed":"maple-st"}'
```

| URL | What |
|---|---|
| http://localhost:3000 | Website: verified projects, project page with the checks panel, invest, portfolio, builder, `/demo` control room. Switch Investor / Builder / Platform in the account menu (top right). |
| http://localhost:3001 | Inspector app: assigned audits, audit form (checklist per Schedule of Values line, geotagged photos), signed submission, audit history, pre-construction site visit. |
| http://localhost:4000 | Core HTTP API (routes in [`docs/05-api.md`](docs/05-api.md)). Both apps proxy `/api/*` to it. |

**Modes.**
- `LEDGER_MODE=fake` (default): no keys, no network. Transaction hashes are not real, even where shown as explorer links.
- `LEDGER_MODE=devnet`: real devnet transactions. Run `pnpm --filter @xrlp/xrpl bootstrap` first (faucet-funded roles into
  `.data/wallets.json`, gitignored); core refuses to start without it. To sign audits in the browser, paste the inspector's devnet seed
  into the inspector app ("Load your inspector key"); it stays in that browser.
- `NEXT_PUBLIC_API_MODE=mock`: either app on its own, on built-in fixtures, no core needed (`pnpm --filter @xrlp/web dev`).
- `VERIFIER_MODE=live` + `ANTHROPIC_API_KEY`: the AI checks call Claude instead of the deterministic mock.

All variables, with defaults: [`.env.example`](.env.example). Demo runbook: [`docs/04-demo-script.md`](docs/04-demo-script.md).

## Test

```bash
pnpm -r typecheck
pnpm -r test                                  # every package; no network, no keys
pnpm --filter @xrlp/inspector test:e2e        # inspector app -> running core (-> devnet with INSPECTOR_SEED). Resets core's demo data.
pnpm --filter @xrlp/xrpl demo                 # full money path on devnet (~6 min), every tx with its explorer link
```

## Repo

| Path | What |
|---|---|
| `apps/web` | Investor / builder website and `/demo` control room |
| `apps/inspector` | Inspector app: queue, audit form, signed audits, history, site visits |
| `packages/core` | Orchestrator, HTTP API, release service (escrow preimages), keeper |
| `packages/xrpl` | Every ledger operation, devnet scripts and proofs, the `LedgerPort` adapter |
| `packages/verifier` | Project verification and the milestone test suite (mock + Claude) |
| `packages/attest-signer` | Inspector software key and audit attestations (signed in the browser) |
| `packages/shared` | The contract: types, states, ports |
| `docs/` | Overview, product, architecture, API, demo script, decisions, submission |

Contributing (lanes, branch rules, handoffs): [`AGENTS.md`](AGENTS.md).
