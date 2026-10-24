import { getBuilderDashboard } from "@/lib/api";
import { handle } from "@/lib/route";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(() => getBuilderDashboard(id));
}
