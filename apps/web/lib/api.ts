// THE data-access seam for the web app. Server components and app/api/* route handlers call ONLY these.
// Today: backed by ./mock-data (in-memory). To switch to @xrlp/core, re-implement these functions
// against core with the same signatures — nothing else in apps/web needs to change.
// Server-only: do not import from client components (use ./client instead).
import type { ChainEvent, Verdict } from "@xrlp/shared";
import * as backend from "./mock-data";
import type {
  AttestInput,
  AttestResult,
  BuilderDashboard,
  DemoAction,
  DemoResult,
  DemoState,
  InspectorQueue,
  InvestInput,
  InvestResult,
  InvestorPortfolio,
  MarketplaceView,
  MilestoneRef,
  MilestoneView,
  Party,
  ProjectDetail,
  SubmitEvidenceInput,
} from "./types";

export { ApiError } from "./mock-data";

export const DATA_MODE: "mock" | "core" = "mock";

// ---------- read models ----------

export async function getMarketplace(): Promise<MarketplaceView> {
  return backend.getMarketplace();
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetail> {
  return backend.getProjectDetail(projectId);
}

export async function getInvestorPortfolio(investorAddress: string): Promise<InvestorPortfolio> {
  return backend.getInvestorPortfolio(investorAddress);
}

export async function getInspectorQueue(inspectorAddress: string): Promise<InspectorQueue> {
  return backend.getInspectorQueue(inspectorAddress);
}

export async function getBuilderDashboard(builderId: string): Promise<BuilderDashboard> {
  return backend.getBuilderDashboard(builderId);
}

/** Demo identities for the role switcher (no auth). */
export async function listParties(): Promise<{
  investors: Party[];
  inspectors: Party[];
  builders: { id: string; name: string; address: string }[];
  platform: Party;
  aiAgent: Party;
}> {
  return backend.listParties();
}

// ---------- actions ----------

export async function invest(input: InvestInput): Promise<InvestResult> {
  return backend.invest(input);
}

/** LoanSet to the project SPV + one EscrowCreate per milestone. */
export async function closeLoan(projectId: string): Promise<ChainEvent[]> {
  return backend.closeLoan(projectId);
}

export async function submitEvidence(input: SubmitEvidenceInput): Promise<MilestoneView> {
  return backend.submitEvidence(input);
}

export async function runAiReview(ref: MilestoneRef): Promise<Verdict> {
  return backend.runAiReview(ref);
}

/** Inspector's signed approve/reject. If it completes the quorum, the key holder's fulfillment finishes the escrow. */
export async function inspectorAttest(input: AttestInput): Promise<AttestResult> {
  return backend.inspectorAttest(input);
}

/** EscrowFinish for a milestone whose quorum is already met (retry path). */
export async function releaseMilestone(ref: MilestoneRef): Promise<ChainEvent> {
  return backend.releaseMilestone(ref);
}

/** EscrowCancel after CancelAfter → funds back to the project account → LoanPay to the vault. */
export async function expireMilestone(ref: MilestoneRef): Promise<ChainEvent[]> {
  return backend.expireMilestone(ref);
}

/** One loan instalment: builder → SPV → LoanPay. */
export async function repay(projectId: string): Promise<ChainEvent> {
  return backend.repay(projectId);
}

// ---------- demo driver ----------

export async function getDemoState(): Promise<DemoState> {
  return backend.getDemoState();
}

export async function runDemoAction(action: DemoAction): Promise<DemoResult> {
  return backend.runDemoAction(action);
}
