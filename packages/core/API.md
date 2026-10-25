# @xrlp/core — v2 (test-suite release model)

HTTP contract: `docs/05-api.md`. `CoreService implements CoreApi` (`src/api-surface.ts`): one method per route 1–23.

```bash
pnpm --filter @xrlp/core serve      # HTTP on :4000 (PORT, DATA_DIR, CORS_ORIGINS); fake ledger + fake verifier by default
pnpm --filter @xrlp/core seed       # = POST /api/admin/demo/reset {"seed":"maple-st"}: wipes DATA_DIR, writes the pre-staged demo
pnpm --filter @xrlp/core simulate   # docs/04-demo-script.md end to end in memory, prints the timeline
pnpm --filter @xrlp/core test
```

## Wiring (`createCore()`)
- `store`: `FileStore(DATA_DIR/core-db.json)` (in-memory with `inMemory: true`).
- `ledger`: `LEDGER_MODE=fake` → `FakeLedger` (state persisted in `DATA_DIR/fake-ledger.json` so seed and server share escrows).
  `devnet` → `XrplLedgerAdapter` (`@xrlp/xrpl`, CORE-05). Needs a bootstrapped `WALLETS_FILE` (relative paths = repo root) and
  `XRPL_NETWORK=devnet`; mainnet endpoints are refused (xrpl's `assertNotMainnet`). Platform / AI agent / release service, the
  demo builder, inspectors 1–3 and investors 1–3 are the `WALLETS_FILE` roles (`src/adapters/devnet-identities.ts`); route 21
  `{"seed":"maple-st"}` registers them (no projects: prestage is CORE-07). First-loss cover is 11% of principal on devnet
  (the ledger wants ≥ 10% of principal + interest). `DEMO_CANCEL_AFTER_S=1500,1800,420` = CancelAfter per milestone, seconds after close.
- `verifier`: `CORE_VERIFIER=fake` → `FakeVerifier` (deterministic Maple St fixtures); on devnet it reads EXIF / pHash / invoice
  totals from the uploaded bytes (`src/adapters/evidence-meta.ts`). `CORE_VERIFIER=verifier`, or `VERIFIER_MODE=live` without
  `CORE_VERIFIER`, → `ClaudeVerifierAdapter` (`@xrlp/verifier`, mode = `VERIFIER_MODE`) via `src/adapters/verifier.ts`.
- Errors from the ledger: `too_soon` / `unsafe_release` → 409, adapter `not_found` → 404, `validation` → 400, else `ledger_error` 502.
- Devnet HTTP e2e: `pnpm --filter @xrlp/core e2e:devnet` against a running devnet server (`scripts/devnet-e2e.ts` header).
- `release`: `ReleaseService` + `FilePreimageVault(DATA_DIR)` (AES-256-GCM sealed preimages). The service never sees a preimage.

## Flow rules (enforced in `src/service.ts`)
fee (max 250 RLUSD, 20 bps) → `verifying` → verify (pass → `verified` + `VERIFIED_BUILDER` on first pass; fail → `rejected`;
needs_human → stays `verifying`, inspectors get a `pre_visit` task) → lock (platform only; AI assigns inspector(s); vault with
SubscriptionDate = funding deadline, RedemptionDate = + term + 7 days; 10% first-loss cover) → invest (KYC'd only, Subscription only,
**never auto-closes**) → close (platform only, **explicit**, `too_soon` before SubscriptionDate; conditions only from the release
service) → evidence (new round on resubmit) → audit (assigned inspector only; attested) → run checks (verdict attested **before**
release; `evaluateRelease` → `verified`→`released` / `failed` / `needs_human`) → operator decision (platform only, reason required,
attested **first**; can't override a failed check) → cancel per milestone (EscrowCancel then refund LoanPay; project `stalled`,
other milestones continue) → repay → withdraw (Redemption only).

`keeperTick()` cancels expired escrows (+ refund), retries pending refunds, and retries releases for `verified` milestones
(e.g. after an `unsafe_release`). Idempotent per step: the cancel and the refund LoanPay commit separately, so a failed
refund is retried alone, and an escrow already cancelled by someone else is refunded without a second cancel. Returns
`{ events, issues }`; each issue is a step (`cancel` | `refund` | `release`) that failed this tick and will be retried.
`KEEPER=1` runs it every 30 s in `serve` (`KEEPER_INTERVAL_MS` overrides; ticks never overlap). `tryStealDemo()` records a `release_refused` event with `tecCRYPTOCONDITION_ERROR`.

Errors: `DomainError` → `toApiError()` → `{ error: { code, message, txResult?, txHash? } }` (codes per 05 §1).

## File-store guarantees and recovery

`FileStore.write` and `reset` acquire an exclusive sibling `.lock` file before
reading or replacing the database, including across Node processes. Writes use
an exclusive temporary file, flush its contents, and rename it over the target.
New files are mode `0600`; newly created directories are mode `0700` (existing
directory permissions are preserved). Reads see the old or new complete file.
Failed callbacks do not commit; malformed JSON is reported rather than reset.

Lock acquisition times out after five seconds with an explicit error. Locks are
never stolen based on age. Following a process crash, stop **all** writers,
remove the database's sibling `.lock` file, then restart. Temporary files left
by a killed process can be removed while all writers are stopped. This is for a
single local filesystem, not distributed storage. It does not serialize ledger
calls made outside the database transaction or deduplicate chain events.

Evidence IDs must be alphanumeric with underscores, hyphens, or colons (including
the demo's `project:m1` milestone IDs); filenames are
sanitized. `FileStore` holds application state, not release preimages: the
separate `FilePreimageVault` retains its existing encryption and key handling.
