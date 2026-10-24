# 05 — API contract (apps ⇄ core, core ⇄ xrpl/verifier)

Types come from `@xrpl/shared` (`Project`, `Milestone`, `Builder`, `Inspector`, `Investment`, `ChainEvent`, `Evidence`, `Verdict`,
`InspectorAudit`, `ProjectVerification`, `Attestation`, `Rlusd`, `XrplAddress`) unless defined here. Owner: **@seanpatrickmay**
(`area:core`). Changing anything here needs a PR that also updates this doc. **Rewritten 2026-10-24 for the test-suite release model**
(`docs/03-architecture.md` §Release). Route numbers changed; old numbers are not reused.

**Topology.**

```
apps/web (bri-yin, :3000) ──┐  Next rewrites /api/* -> CORE_URL
apps/inspector (Roro, :3001)┴──HTTP──> packages/core HTTP server (seanpatrickmay, :4000, `pnpm --filter @xrlp/core serve`)
                                         ├─ LedgerPort   <- packages/xrpl/src/adapter.ts      (Jalil-g)
                                         ├─ VerifierPort <- packages/verifier/src/adapter.ts  (elmir132)
                                         └─ ReleaseService (core-internal: preimages, evaluateRelease, pre-reveal safety, keeper)
Port interfaces live in packages/shared/src/ports.ts.
```

## 1. Conventions

- Routes: zod-parse → service method → JSON. Apps hold **no business logic**; one typed client per app
  (`apps/web/lib/api.ts`, `apps/inspector/lib/api.ts`) switching `NEXT_PUBLIC_API_MODE=mock|http`. CORS for `:3000`/`:3001`.
  Evidence and audit files at `GET /api/files/:fileId`.
- Money = `Rlusd` decimal string. Times = ISO. Every response that caused a tx includes `events: ChainEvent[]`.
- Errors: `{ error: { code, message, txResult?, txHash? } }`,
  `ErrorCode = "not_found" | "invalid_state" | "validation" | "checks_failed" | "needs_human" | "too_soon" | "ledger_error" | "verifier_error" | "unsafe_release"`.
  `unsafe_release` = pre-reveal safety refused to submit a finish (no trust line, escrow gone, past `CancelAfter`).
- Demo identity: no auth. Requests carry `actor: XrplAddress` where a role matters. Core holds demo keys for platform, releaseService,
  trustee, aiAgent, investors, builder **and the inspectors' software keys** (inspector attestations are signed in the inspector
  app via `@xrlp/attest-signer` `SoftwareSigner` (package today named `ledger-signer`; INS-04 renames it) when `signedTxBlob` is sent, otherwise core signs with the inspector's demo key).

## 2. HTTP routes

| # | Method & path | Body | 200 response | Core call |
|---|---|---|---|---|
| 1 | `GET /api/projects` | `?status=verified` | `ProjectSummary[]` (marketplace shows `verified` + later) | `listProjects()` |
| 2 | `GET /api/projects/:id` | — | `ProjectDetail` | `getProject(id)` |
| 3 | `POST /api/projects` | `CreateProjectInput` (SoV + docs) | `Project` (`draft`) | `createProject()` |
| 4 | `POST /api/projects/:id/verification-fee` | `{ builder }` | `{ project, events }` (`Payment` fee → `verifying`) | `payVerificationFee()` |
| 5 | `POST /api/projects/:id/verify-project` | — | `{ verification: ProjectVerification, project, events }` (`verified` or `rejected`; `needs_human` → inspector pre-visit task) | `verifyProject()` (AI; credential on first pass) |
| 6 | `POST /api/projects/:id/lock-terms` | `{ actor }` (platform) | `{ project, assignment: InspectorAssignment, events }` (AI assigns inspector(s); vault+broker+cover+SPV → `funding`) | `lockTermsAndOpenFunding()` |
| 7 | `POST /api/projects/:id/investments` | `{ investor, amount }` | `{ investment, events }` | `invest()` |
| 8 | `POST /api/projects/:id/close` | `{ actor }` | `{ project, events }` (`escrowed`; `too_soon` before SubscriptionDate; release service generates conditions) | `closeLoan()` |
| 9 | `POST /api/projects/:id/milestones/:mid/evidence` | multipart `files[]`, `kind[]` | `{ milestone, evidence }` | `submitEvidence()` |
| 10 | `POST /api/projects/:id/milestones/:mid/audit` | multipart `report` (JSON `InspectorAudit`), `photos[]`, optional `signedTxBlob` | `{ milestone, audit, events }` (audit attestation tx) | `submitAudit()` (must be the assigned inspector) |
| 11 | `POST /api/projects/:id/milestones/:mid/run-checks` | — | `{ verdict, release?: { txHash, explorerUrl }, events }` (runs suite; AI attestation; **auto-release on pass**) | `runChecks()` → `evaluateRelease()` |
| 12 | `POST /api/projects/:id/milestones/:mid/decision` | `{ actor, decision: "approve" \| "reject", reason }` | `{ milestone, events }` (platform operator resolves `needs_human`; signed reason attested) | `resolveNeedsHuman()` |
| 13 | `POST /api/projects/:id/milestones/:mid/cancel` | — | `{ milestone, events }` (`refunded` + `LoanPay`) | `cancelExpired()` |
| 14 | `POST /api/projects/:id/repayments` | `{ amount }` | `{ project, events }` | `repay()` |
| 15 | `POST /api/projects/:id/withdrawals` | `{ investor, amount }` | `{ events }` (`too_soon` before RedemptionDate) | `withdraw()` |
| 16 | `GET /api/projects/:id/events` | — | `ChainEvent[]` newest first | `listEvents()` |
| 17 | `GET /api/builders` · `GET /api/builders/:id` | — | `Builder[]` / `Builder` | `listBuilders()` |
| 18 | `GET /api/inspectors` · `GET /api/inspectors/:address/queue` | — | `Inspector[]` / `InspectorTask[]` (`needs: "pre_visit" \| "audit" \| "re_audit" \| "none"`) | `inspectorQueue()` |
| 19 | `POST /api/investors/:address/kyc` | — | `{ events }` | `kycInvestor()` |
| 20 | `GET /api/portfolio/:investor` | — | `PortfolioPosition[]` | `portfolio()` |
| 21 | `POST /api/admin/demo/reset` | `{ seed?: "maple-st" }` | `{ ok }` | `resetDemo()` |
| 22 | `POST /api/admin/keeper/tick` | — | `{ events }` | `keeperTick()` |
| 23 | `POST /api/admin/demo/try-steal/:id/:mid` | — | `{ result: "tecCRYPTOCONDITION_ERROR", txHash, explorerUrl }` (wrong fulfillment, never reads stored preimages) | `tryStealDemo()` |

```ts
type SovLine = { code: string; title: string; amount: Rlusd; trade: string; evidence: EvidenceRequirement[]; visualCriteria: string[] };
type CreateProjectInput = Pick<Project, "name" | "type" | "builderId" | "siteAddress" | "siteGeo" | "description"> & {
  terms: LoanTerms;                     // fundingDeadline -> Vault.SubscriptionDate
  sov: SovLine[];                       // templates = pre-filled SoVs for residential
  documents: BuilderDocument[];         // licence, insurance, entity, permits/plans (mock)
};
type ProjectVerification = { identity: CheckResult[]; feasibility: CheckResult[]; capability: CheckResult[];
  decision: "pass" | "fail" | "needs_human"; riskTier: RiskTier; summary: string; model: string; createdAt: string };
type InspectorAssignment = { inspectors: XrplAddress[]; scores: Record<XrplAddress, number>; reasons: string[] };
type InspectorAudit = { milestoneId: string; inspector: XrplAddress; evidenceBundleHash: string;
  checklist: { sovCode: string; status: "done" | "partial" | "not_done"; note?: string }[]; photos: Evidence[]; notes: string;
  txHash?: string; at: string };
type ChecksStatus = { required: CheckResult[]; optional: CheckResult[]; verdict?: Verdict; outcome: "pending" | "pass" | "fail" | "needs_human" };
type ProjectSummary = Pick<Project, "id" | "name" | "type" | "status" | "siteAddress"> & { principal: Rlusd; raised: Rlusd;
  investorCount: number; builderName: string; fundingDeadline: string; verified: boolean };
type ProjectDetail = { project: Project; builder: Builder; verification?: ProjectVerification; inspectors: Inspector[];
  investments: Investment[]; events: ChainEvent[]; checks: Record<string /*milestoneId*/, ChecksStatus>;
  audits: Record<string, InspectorAudit[]>; attestations: Record<string, Attestation[]>; vault?: VaultSnapshot; loan?: LoanSnapshot };
type InspectorTask = { projectId: string; projectName: string; milestone?: Milestone; sov: SovLine[]; evidence: Evidence[];
  needs: "pre_visit" | "audit" | "re_audit" | "none"; siteGeo: Project["siteGeo"]; priorAudits: InspectorAudit[] };
type PortfolioPosition = { projectId: string; projectName: string; shares: string; value: Rlusd; phase: VaultSnapshot["phase"]; redemptionDate: string };
type VaultSnapshot = { assetsTotal: Rlusd; assetsAvailable: Rlusd; sharesOutstanding: string; sharePrice: string;
  subscriptionDate: string; redemptionDate: string; phase: "subscription" | "investment" | "redemption" };
type LoanSnapshot = { principalOutstanding: Rlusd; totalValueOutstanding: Rlusd; periodicPayment: Rlusd; paymentRemaining: number; nextPaymentDueDate: string };
```

## 3. Ports (core ⇄ adapters) — `packages/shared/src/ports.ts`

**`ports.ts` is the source of truth** (CORE-01, #53); the sketch below is the summary. Concrete choices made there:
- Adapters return `TxResult { hash, explorerUrl, result, kind?, at? }`, not `ChainEvent`s. Core adds project/milestone context
  and turns them into `ChainEvent`s. Composite calls return `txs: TxResult[]` (`ProjectChainSetup`, `CloseResult`).
- Failures throw `LedgerError { code: "too_soon" | "ledger_error" | "unsafe_release", txResult?, txHash? }`; `TooSoonError` extends it.
- `closeLoanAndCreateEscrows` also takes `project` + `builder`; `conditions[i]` / `cancelAfters[i]` map to `project.milestones[i]`.
- `attest` takes the SPV as memo destination: `attest({ signer, spv, memo })`.
- Added `tryFinishWithWrongFulfillment({ owner, offerSequence, condition })` for route 23: platform-signed `EscrowFinish` with
  random bytes; **resolves** with the `tec` result instead of throwing, and never sees a stored preimage.
- `policyFor(project, milestone)` returns `ReleasePolicy { riskTier, requiredChecks, optionalChecks, minConfidence, requiredAudits }`.
- Status enums are a **superset** during migration: `MilestoneStatus` still accepts `ai_reviewed | inspected | rejected`
  (`LEGACY_MILESTONE_STATUSES`, deprecated). New code uses `MILESTONE_STATUSES_V2` and `MILESTONE_TRANSITIONS_V2` /
  `PROJECT_TRANSITIONS_V2` from `packages/shared/src/states.ts`. Legacy values are removed once core (CORE-03) and web stop emitting them.

```ts
interface LedgerPort {
  // onboarding / compliance
  payVerificationFee(p): Promise<TxResult>;                 // builder -> platform RLUSD Payment
  issueCredential(p: { subject; type: "VERIFIED_BUILDER"|"VERIFIED_INSPECTOR"|"KYC_INVESTOR" }): Promise<TxResult[]>; // create + accept
  // project setup
  setupProjectOnChain(p): Promise<ProjectChainSetup>;       // closed vault(private, dates, AssetsMaximum) + broker(cover rates) + coverDeposit + SPV(SignerList platform/builder/inspector/trustee, quorum 3)
  deposit(p) / withdraw(p): Promise<TxResult>;              // withdraw throws TooSoonError before RedemptionDate
  closeLoanAndCreateEscrows(p: { conditions: Hex[]; cancelAfters: ISO[] }): Promise<CloseResult>; // LoanSet countersigned + EscrowCreate×N; TooSoonError; CancelAfter < maturity; rejects duplicate conditions
  // release path
  preflightFinish(p: { owner; offerSequence; destination }): Promise<{ ok: boolean; reason?: string }>; // escrow open, not expired, trust line exists
  finishEscrow(p: { owner; offerSequence; condition; fulfillment }): Promise<TxResult>;   // submitter = releaseService
  cancelEscrow(p) / repayLoan(p: { source: "builder"|"escrow_refund" }) : Promise<TxResult>;
  attest(p: { signer: "aiAgent"|"platform"|"releaseService"; memo: AttestMemo }): Promise<TxResult>;
  submitSignedBlob(blob: string): Promise<TxResult>;        // inspector-app-signed attestation
  // reads
  getVaultSnapshot(p) / getLoanSnapshot(p) / getEscrow(owner, seq) / getBalance(account, currency)
}
interface VerifierPort {
  verifyProject(input: VerifyProjectInput): Promise<ProjectVerification>;
  assignInspector(input: { project: Project; panel: Inspector[]; count: 1|2 }): Promise<InspectorAssignment>;
  verifyMilestone(input: VerifyMilestoneInput): Promise<Verdict>;  // input includes the InspectorAudit(s) + prior evidence of ALL projects
  policyFor(project, milestone): ReleasePolicy;                      // required checks, minConfidence, requiredAudits
  verdictHash(v: Verdict): string;                                   // canonical sha256
}
```

`AttestMemo` (memo type `xrlp/attest/v1`, JSON): `{ v:1, kind: "audit"|"verdict"|"decision"|"release", milestoneId, hash, decision?, reason? }`.
Mock verifier is deterministic for the Maple St fixtures: foundation → `pass`; framing (reused photo) → `fail`; a milestone without an
audit → `fail` on `inspector_audit_present`.
