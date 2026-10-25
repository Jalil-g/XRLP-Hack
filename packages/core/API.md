# @xrlp/core — API

Workflow orchestrator + JSON store. Runs today on fakes (`FakeLedger`, `FakeVerifier`); real adapters plug in via the ports in `src/ports.ts`.

```ts
import { createCore, isDomainError } from "@xrlp/core";
const core = createCore();            // FileStore at DATA_DIR (default <repo>/.data/core-db.json), fakes
// core.service  -> mutations (CoreService)      core.read -> read models (ReadModels)
```

Create **one core per server process** (module-level singleton). All money is `Rlusd` decimal strings (`"25000.00"`). All read models are plain JSON.

**Errors**: every expected failure throws `DomainError { code, message, details, status }`, where
`code` is one of `NOT_FOUND | VALIDATION | ILLEGAL_TRANSITION | FORBIDDEN | CONFLICT | QUORUM_NOT_MET | LEDGER_ERROR | VERIFIER_ERROR`. `status` is the suggested HTTP status (404/400/409/403/502). Route handlers can do
`catch (e) { if (isDomainError(e)) return Response.json({ error: e.code, message: e.message }, { status: e.status }) }`.

Zod input schemas are exported for reuse: `RegisterBuilderInput`, `CreateProjectInput`, `EvidenceInput`, `RegisterInvestorInput`, `RegisterInspectorInput`.

## Mutations — `core.service`

| Method | Allowed when | Effect / chain events |
|---|---|---|
| `registerBuilder({name, address, licenseNumber, insurancePolicy, completedProjects?, riskTier?, id?})` | — | Builder (`verified: false`) |
| `verifyBuilder(builderId, documents: BuilderDocument[])` | not yet verified | AI doc review → if ok `credential_issued` (VERIFIED_BUILDER), `verified: true`, riskTier from verifier. Returns `{builder, verification, event?}` |
| `registerInvestor({address, name})` | — | mock KYC → `credential_issued` (KYC_INVESTOR) |
| `registerInspector({address, name, licenseNumber})` | — | — |
| `createProject({builderId, name, type, siteAddress, siteGeo, description, terms, inspectors, id?})` | builder verified | `draft`; milestones from `MILESTONE_TEMPLATES[type]`, amount = defaultShare × principal, `requiredInspectors` from `verifier.policyFor`. `inspectors[0]` = default escrow-condition holder |
| `lockTerms(projectId)` | `draft` | → `terms_locked` |
| `openFunding(projectId)` | `terms_locked`, before deadline | SPV + Vault + LoanBroker on-chain (`vault_created`, `loan_broker_created`) → `funding` |
| `submitMilestoneConditions(projectId, {inspector, conditions:[{milestoneId, condition}]})` | before `escrowed`; assigned inspector | stores **public** PREIMAGE-SHA-256 conditions. Inspector keeps fulfillments (see below). If already `funded` → auto close |
| `invest(projectId, {investor, amount})` | `funding`, KYC'd investor, ≤ remaining, before deadline | `vault_deposit`. Last deposit → `funded` → (autoClose + all conditions present) `closeLoan` |
| `closeLoan(projectId)` | `funded`, all conditions present | `loan_set` + one `escrow_created` per milestone (same step) → project `escrowed`, milestones `escrowed` with `cancelAfter` |
| `checkFundingDeadline(projectId)` | `funding` past deadline | → `stalled` (investors withdraw). Returns boolean |
| `submitEvidence(projectId, milestoneId, {evidence: EvidenceInput[]})` | milestone `escrowed` or `rejected`, before cancelAfter | new review round → `evidence_submitted`. Store files first with `saveEvidenceBlob(core.dataDir, …)` → `{uri, sha256}` |
| `runAiReview(projectId, milestoneId)` | `evidence_submitted` | Verdict stored. `pass` → AI `approval_attested` + `ai_reviewed`; `needs_human` → `ai_reviewed` (no AI approval); `fail` → `rejected` |
| `inspectorAttest(projectId, milestoneId, {inspector, decision, notes?, fulfillment?})` | `ai_reviewed`/`inspected`, assigned inspector, once per round | `approval_attested`. reject → `rejected`; approve → `inspected`. If quorum now met **and** `fulfillment` given → releases in the same call (`released` in result) |
| `platformAttest(projectId, milestoneId, {decision, notes?})` | `ai_reviewed`/`inspected` | platform co-sign (weight 1), `approval_attested` |
| `releaseMilestone(projectId, milestoneId, {fulfillment})` | `inspected` + quorum met + fulfillment matches condition | `escrow_finished` → `released` |
| `expireMilestone(projectId, milestoneId)` | escrow still locked and `now ≥ cancelAfter` | → `expired` → `escrow_cancelled` + `loan_payment` (refund LoanPays the vault) → `refunded`; project → `stalled` |
| `sweepExpired(projectId?)` | — | `expireMilestone` for everything past CancelAfter (cron / admin "fast-forward") |
| `repayLoan(projectId, {amount})` | `escrowed`/`repaying`/`stalled`, ≤ outstanding | `loan_payment`; → `repaying`; fully repaid + all milestones settled → `completed` |
| `withdraw(projectId, {investor, amount?})` | `escrowed`/`repaying`/`stalled`/`completed` | `vault_withdraw`; default amount = everything withdrawable (pro-rata share of liquid vault assets) |

**Approval rule** (`evaluateQuorum`, mirrors the SPV SignerList): inspector weight 2, AI 1, platform 1, quorum 3 → an inspector is **always** required plus one of: second inspector / AI pass / platform. If the milestone's `requiredInspectors` is 2, both inspectors must approve. Any reject blocks. A resubmission starts a new round; old attestations don't count.

**Escrow fulfillments** are generated and held by the condition-holding inspector (`generateMilestoneCondition()` → `{condition, fulfillment}`), never by core. The inspector UI must supply `fulfillment` when approving (or later via `releaseMilestone`). Demo stand-in for the inspector's device: `FileInspectorKeyring(inspectorAddress, dataDir)` (`.conditionFor(milestoneId)`, `.fulfillmentFor(milestoneId)`) — kept outside the core store. `getInspectorQueue` shows which items need the fulfillment.

## Read models — `core.read`

| Method | Returns |
|---|---|
| `getMarketplace({status?})` | `ProjectCard[]` — name, type, status, builder summary (verified, riskTier), principal, raised, fundedPct, investorCount, rate, term, deadline, milestone counts, releasedAmount, nextMilestone |
| `getProjectDetail(id)` | `{project, card, builder, inspectors, milestones: MilestoneView[], funding {raised, remaining, fundedPct, investors[]}, vault {deposits, available, loaned, owed, repaid, outstanding, withdrawn, totalValue}, timeline: ChainEvent[], activity: ActivityItem[], stalledReason?}` |
| `getInvestorPortfolio(address)` | `{address, name, kycCredentialTx, positions[{project, deposited, withdrawn, sharePct, currentValue, withdrawable, events}], totals}` |
| `getInspectorQueue(address)` | `{inspector, pending[] (needs my signature), awaitingRelease[] (quorum met, I hold the condition), conditionsNeeded[] (pre-escrow), history[]}` |
| `getBuilderDashboard(builderId)` | `{builder, verification, credentialEvent, projects[card + milestoneViews + nextAction], totals {released, locked, repaid, outstanding}}` |
| `getDirectory()` | builders / investors / inspectors (role switcher) |
| `getPlatformEvents()` | credential events (projectId `"_platform"`) |

`MilestoneView` = `Milestone` + `template` (required evidence, visual criteria), `round`, current-round `evidence`, latest `verdict` (+`verdictHistory`), current-round `attestations`, `quorum` (`met`, `weight`, `missing[]` human-readable), `conditionHolder`, `awaitingFulfillment`, `events`.

`ActivityItem` merges chain events with off-chain steps (evidence uploaded, AI verdict, attestations) — use it for the project's audit feed. Every chain event has `explorerUrl`.

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

Evidence IDs must be alphanumeric with underscores/hyphens; filenames are
sanitized. `FileStore` holds application state, not release preimages: the
separate `FilePreimageVault` retains its existing encryption and key handling.

## Scripts

```bash
pnpm --filter @xrlp/core seed [--stage=funding] [--keep]   # fresh|verified|funding|escrowed|m1-released|fraud-caught
pnpm --filter @xrlp/core simulate                          # whole demo story in memory, prints timeline
pnpm --filter @xrlp/core test
```

Env: `DATA_DIR` (store location), `LEDGER_MODE=fake` (devnet adapter TODO), `CORE_VERIFIER=fake` (verifier adapter TODO), `FAKE_LEDGER_DELAY_MS` (simulated tx latency, e.g. `1500` for a realistic demo).

Demo helpers: `import { demo } from "@xrlp/core"` — `demo.DEMO` (fixed names/addresses), `demo.MAPLE_ID`, `demo.MAPLE_M`, and the story steps (`mapleToEscrowed`, `mapleMilestone1`, `mapleMilestone2Fraud`, `mapleExpireMilestone3`). `demoPhoto()` / `demoDoc()` create SVG data-URL evidence.
