// Milestone actions. Body always carries { projectId, milestoneId } (milestone ids contain ':').
// POST /api/milestones/evidence  SubmitEvidenceInput
// POST /api/milestones/review    MilestoneRef
// POST /api/milestones/attest    AttestInput
// POST /api/milestones/release   MilestoneRef
// POST /api/milestones/expire    MilestoneRef
import { ApiError, expireMilestone, inspectorAttest, releaseMilestone, runAiReview, submitEvidence } from "@/lib/api";
import { body, handle } from "@/lib/route";
import type { AttestInput, MilestoneRef, SubmitEvidenceInput } from "@/lib/types";

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return handle(async () => {
    switch (action) {
      case "evidence":
        return submitEvidence(await body<SubmitEvidenceInput>(req));
      case "review":
        return runAiReview(await body<MilestoneRef>(req));
      case "attest":
        return inspectorAttest(await body<AttestInput>(req));
      case "release":
        return releaseMilestone(await body<MilestoneRef>(req));
      case "expire":
        return expireMilestone(await body<MilestoneRef>(req));
      default:
        throw new ApiError(`Unknown action ${action}`, 404);
    }
  });
}
