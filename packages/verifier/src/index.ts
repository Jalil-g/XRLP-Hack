// @xrlp/verifier — AI + deterministic evidence verification. See ../API.md.
export { createLiveJudge, verifyMilestone, verifyMilestoneDetailed, decide } from "./verifyMilestone.ts";
export type { VerifyMilestoneResult, VerifyOptions } from "./verifyMilestone.ts";
export { verifyBuilder, MOCK_REGISTRY } from "./verifyBuilder.ts";
export type { BuilderDocument, BuilderRegistry, BuilderVerdict, InsuranceRecord, LicenseRecord, VerifyBuilderInput } from "./verifyBuilder.ts";
export { policyFor } from "./policy.ts";
export type { CheckRule, Escalation, PolicyThresholds, VerificationPolicy } from "./policy.ts";
export {
  extractEvidenceMeta,
  hammingDistance,
  loadEvidence,
  loadEvidenceBytes,
  parseExifDate,
  parseInvoiceTotal,
  perceptualHash,
  sha256Hex,
} from "./meta.ts";
export type { EvidenceFile, ExtractedMeta } from "./meta.ts";
export { MockJudge } from "./llm/mock.ts";
// LiveJudge is intentionally not re-exported statically: use createLiveJudge() (lazy SDK import).
export type { MilestoneJudge, MilestoneJudgeInput, MilestoneJudgement } from "./llm/types.ts";
export { DEFAULT_MODEL, resolveMode, resolveModel } from "./config.ts";
export {
  DETERMINISTIC_CHECKS,
  LAZY_FRAUD_ONLY_CHECKS,
  LLM_CHECKS,
  MILESTONE_CHECKS,
} from "./types.ts";
export type {
  CheckOutcome,
  LoadedEvidence,
  MilestoneCheckName,
  MilestoneTimeline,
  PriorEvidence,
  VerifierMode,
  VerifyMilestoneInput,
} from "./types.ts";
