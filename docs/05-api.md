# 05 — API contract (apps ⇄ core, core ⇄ xrpl/verifier)

Types come from `@xrlp/shared` (`Project`, `Milestone`, `Builder`, `Investment`, `ChainEvent`, `Evidence`, `Verdict`,
`Attestation`, `Rlusd`, `XrplAddress`) unless defined here. Owner: **@seanpatrickmay** (`area:core`). Changing anything
here needs a PR that also updates this doc.

**Topology.** Two front-ends talk to one backend, and each directory has exactly one owner:

```
apps/web (bri-yin, :3000) ──┐  Next rewrites /api/* -> CORE_URL
apps/inspector (Roro, :3001)┴──HTTP──> packages/core HTTP server (seanpatrickmay, :4000, `pnpm --filter @xrlp/core serve`)
                                         ├─ LedgerPort   <- packages/xrpl/src/adapter.ts      (Jalil-g)
                                         └─ VerifierPort <- packages/verifier/src/adapter.ts  (elmir132)
Port interfaces live in packages/shared/src/ports.ts, so xrpl and verifier implement them without importing core.
```

## 1. Conventions

- Routes are served by `packages/core/src/http/` (zod-parse → service method → JSON). The apps hold **no business logic**;
  each app has one typed client (`apps/web/lib/api.ts`, `apps/inspector/lib/api.ts`) that switches between mock and http with `NEXT_PUBLIC_API_MODE=mock|http`.
  CORS is allowed for `:3000` and `:3001`. Evidence files are served at `GET /api/files/:evidenceId`.
- Money is always an `Rlusd` decimal string. Times are ISO strings. Every response that caused a tx includes `events: ChainEvent[]`.
- Errors: HTTP 4xx/5xx with `{ error: { code: ErrorCode, message: string, txResult?: string, txHash?: string } }`.
  `ErrorCode = "not_found" | "invalid_state" | "validation" | "quorum_not_met" | "condition_mismatch" | "too_soon" | "ledger_error" | "verifier_error"`.
  `too_soon` covers ledger time gates such as `tecTOO_SOON` on LoanSet before `SubscriptionDate`, and withdraw before `RedemptionDate`.
- Demo identity: there is no auth. Requests carry `actor: XrplAddress` where a role matters. Core holds the demo keys for platform, trustee, aiAgent and
  demo investors/builder. **The inspector's preimage never touches core storage.**

## 2. HTTP routes

| # | Method & path | Body | 200 response | Core call |
|---|---|---|---|---|
| 1 | `GET /api/projects` | — | `ProjectSummary[]` | `listProjects()` |
| 2 | `GET /api/projects/:id` | — | `ProjectDetail` | `getProject(id)` |
| 3 | `POST /api/projects` | `CreateProjectInput` | `Project` (`draft`) | `createProject()` |
| 4 | `POST /api/projects/:id/lock-terms` | `{ actor }` (platform) | `{ project, events }` (vault+broker+cover+SPV created → `funding`) | `lockTermsAndOpenFunding()` |
| 5 | `POST /api/projects/:id/investments` | `{ investor: XrplAddress, amount: Rlusd }` | `{ investment: Investment, events }` | `invest()` |
| 6 | `POST /api/projects/:id/milestones/:mid/condition` | `{ inspector: XrplAddress, condition: string }` | `{ milestone }` | `registerCondition()` (rejects duplicates/malformed) |
| 7 | `POST /api/projects/:id/close` | `{ actor }` | `{ project, events }` (`escrowed`; `too_soon` before SubscriptionDate) | `closeLoan()` (needs all conditions) |
| 8 | `POST /api/projects/:id/milestones/:mid/evidence` | multipart: `files[]`, `kind[]` | `{ milestone, evidence: Evidence[] }` | `submitEvidence()` |
| 9 | `POST /api/projects/:id/milestones/:mid/verify` | — | `{ verdict: Verdict, events }` (AI attestation tx) | `runVerification()` |
| 10 | `POST /api/projects/:id/milestones/:mid/attestations` | `{ role, signer, decision, notes?, signedTxBlob? }` | `{ attestation: Attestation, quorum: QuorumStatus, events }` | `attest()` (`signedTxBlob` = Ledger/client-signed memo tx) |
| 11 | `POST /api/projects/:id/milestones/:mid/release` | `{ fulfillment: string } \| { txHash: string }` | `{ milestone, events }` (`released`) | `release()` (`condition_mismatch`, `quorum_not_met`) |
| 12 | `POST /api/projects/:id/milestones/:mid/cancel` | — | `{ milestone, events }` (`refunded` + LoanPay event) | `cancelExpired()` |
| 13 | `POST /api/projects/:id/repayments` | `{ amount: Rlusd }` (builder → SPV → LoanPay) | `{ project, events }` | `repay()` |
| 14 | `POST /api/projects/:id/withdrawals` | `{ investor, amount: Rlusd }` | `{ events }` (`too_soon` before RedemptionDate) | `withdraw()` |
| 15 | `GET /api/projects/:id/events` | — | `ChainEvent[]` (newest first). Optional SSE: `?stream=1` | `listEvents()` |
| 16 | `GET /api/builders` / `GET /api/builders/:id` | — | `Builder[]` / `Builder` | `listBuilders()` |
| 17 | `POST /api/builders/:id/verify` | `{ documents: BuilderDocument[] }` | `{ builder, verification: BuilderVerification, events }` (credential) | `verifyBuilder()` |
| 18 | `POST /api/investors/:address/kyc` | — | `{ events }` (KYC_INVESTOR issued + accepted) | `kycInvestor()` |
| 19 | `POST /api/admin/demo/reset` | `{ seed?: "maple-st" }` | `{ ok: true }` | `resetDemo()` |
| 20 | `POST /api/admin/keeper/tick` | — | `{ events }` (cancels expired escrows, repays refunds) | `keeperTick()` |
| 21 | `GET /api/inspectors/:address/queue` | — | `InspectorTask[]` | `inspectorQueue()` |
| 22 | `GET /api/portfolio/:investor` | — | `PortfolioPosition[]` | `portfolio()` |

```ts
type CreateProjectInput = Pick<Project, "name" | "type" | "builderId" | "siteAddress" | "siteGeo" | "description"> & {
  terms: LoanTerms;                       // fundingDeadline -> Vault.SubscriptionDate
  milestoneAmounts?: Rlusd[];             // default: template defaultShare × principal
  inspectors: XrplAddress[];              // assigned BEFORE close (condition is immutable)
};
type ProjectSummary = Pick<Project, "id" | "name" | "type" | "status" | "siteAddress"> & {
  principal: Rlusd; raised: Rlusd; investorCount: number; builderName: string; fundingDeadline: string;
};
type ProjectDetail = {
  project: Project; builder: Builder; investments: Investment[]; events: ChainEvent[];
  verdicts: Record<string /*milestoneId*/, Verdict[]>; attestations: Record<string, Attestation[]>;
  vault?: VaultSnapshot; loan?: LoanSnapshot;
};
type InspectorTask = { projectId: string; projectName: string; milestone: Milestone; verdict?: Verdict;
  attestations: Attestation[]; needs: "condition" | "review" | "release" | "none"; siteGeo: Project["siteGeo"] };
type PortfolioPosition = { projectId: string; projectName: string; shares: string; value: Rlusd;
  phase: VaultSnapshot["phase"]; redemptionDate: string };
type VaultSnapshot = { assetsTotal: Rlusd; assetsAvailable: Rlusd; sharesOutstanding: string;
  sharePrice: string; subscriptionDate: string; redemptionDate: string; phase: "subscription" | "investment" | "redemption" };
type LoanSnapshot = { principalOutstanding: Rlusd; totalValueOutstanding: Rlusd; periodicPayment: Rlusd;
  paymentRemaining: number; nextPaymentDueDate: string };
```

## 3. Ports (core ⇄ adapters)

`LedgerPort` and `VerifierPort` keep the shapes in today's `packages/core/src/ports.ts`. They **move to
`packages/shared/src/ports.ts`** (CORE-01), so that `packages/xrpl/src/adapter.ts` (`XrplLedgerAdapter implements LedgerPort`) and
`packages/verifier/src/adapter.ts` (`ClaudeVerifierAdapter implements VerifierPort`) only depend on shared.
`packages/core/src/factory.ts` selects them with `LEDGER_MODE=fake|devnet` and `VERIFIER_MODE=fake|mock|live`. The fakes stay in core.

**Required deltas from the protocol review** (@seanpatrickmay owns the PR; @Jalil-g and @elmir132 review):

1. `setupProjectOnChain` → the vault must be **closed-ended**: pass `subscriptionDate` (= `terms.fundingDeadline`) and
   `redemptionDate` (= maturity + buffer ≥ 60s). Return them in `ProjectChainSetup`. It also does `LoanBrokerCoverDeposit`
   and returns a `cover_deposited` event. SPV signer list: `{platform, builder, inspector, trustee}` w1 each, quorum 3.
   **No aiAgent on the list.**
2. `closeLoanAndCreateEscrows` → LoanSet with platform as `Account` and the SPV as multisig `Counterparty`,
   `tfLoanOverpayment`, `PaymentTotal ≥ 2`. It throws a typed `TooSoonError` before `SubscriptionDate`. Each escrow's
   `CancelAfter` must fall before loan maturity.
3. `repayLoan({ source: "escrow_refund" })` → LoanPay with `tfLoanOverpayment`.
4. New reads, used by the UI and the keeper: `getVaultSnapshot(project)`, `getLoanSnapshot(project)`, `getEscrow(owner, offerSequence)`.
5. `core/src/quorum.ts` → **release policy, not signer weights.** Release is allowed when the inspector approves and the fulfillment
   matches. An AI `pass` is required unless an inspector `override` attestation exists. The platform approval is recorded.
6. `@xrlp/shared` PR: `ChainEvent.kind += "cover_deposited" | "credential_accepted" | "loan_default"`; `LoanTerms += paymentTotal`;
   `Project.chain += subscriptionDate, redemptionDate, coverAmount`; `Milestone += inspector: XrplAddress`.

```ts
// @xrlp/xrpl internal surface used by its own adapter.ts (Jalil-g keeps names stable once XRPL-04 lands)
createRlusdIssuer(); fundAccount(); setTrustLine(acct, limit);
createClosedVault({ owner, asset, subscriptionDate, redemptionDate, assetsMaximum, domainId? }) -> { vaultId, shareMptId, tx }
createLoanBroker({ owner, vaultId, coverRateMinimum, coverRateLiquidation }) -> { loanBrokerId, tx }
coverDeposit({ owner, loanBrokerId, amount }) -> tx
createSpv({ signers, quorum }) -> { address, txs }        // SignerListSet + asfDisableMaster
loanSetCountersigned({ broker, spv, spvSigners, terms }) -> { loanId, tx }
escrowCreateMultisig({ spv, spvSigners, destination, amount, condition, cancelAfter }) -> { offerSequence, tx }
escrowFinish({ submitter, owner, offerSequence, condition, fulfillment }) -> tx
escrowCancel({ submitter, owner, offerSequence }) -> tx
loanPayMultisig({ spv, spvSigners, loanId, amount, overpayment }) -> tx
vaultDeposit / vaultWithdraw / attest({ signer, memo }) / issueCredential / acceptCredential / createDomain
getVault / getLoan / getEscrow
// every tx -> { hash, result, explorerUrl }; throws XrplTxError{ result } on non-tesSUCCESS
```

`VerifierPort` is unchanged. `verifyMilestone` must be deterministic in `mock` mode for the demo fixtures:
Maple St foundation → `pass`, framing with a reused photo → `fail`.
