import { getInvestorPortfolio } from "@/lib/api";
import { handle } from "@/lib/route";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  return handle(() => getInvestorPortfolio(address));
}
