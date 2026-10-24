// POST /api/projects/:id/invest   { investor, amount }
// POST /api/projects/:id/close
// POST /api/projects/:id/repay
import { ApiError, closeLoan, invest, repay } from "@/lib/api";
import { body, handle } from "@/lib/route";
import type { InvestInput } from "@/lib/types";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return handle(async () => {
    switch (action) {
      case "invest": {
        const b = await body<Omit<InvestInput, "projectId">>(req);
        return invest({ projectId: id, investor: b.investor, amount: b.amount });
      }
      case "close":
        return closeLoan(id);
      case "repay":
        return repay(id);
      default:
        throw new ApiError(`Unknown action ${action}`, 404);
    }
  });
}
