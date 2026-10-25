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
  `devnet` → TODO adapter in `packages/xrpl`.
- `verifier`: `CORE_VERIFIER=fake` → `FakeVerifier` (deterministic Maple St fixtures). `verifier` → TODO adapter in `packages/verifier`.
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
(e.g. after an `unsafe_release`). Idempotent. `tryStealDemo()` records a `release_refused` event with `tecCRYPTOCONDITION_ERROR`.

Errors: `DomainError` → `toApiError()` → `{ error: { code, message, txResult?, txHash? } }` (codes per 05 §1).
