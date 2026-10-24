import { getMarketplace } from "@/lib/api";
import { handle } from "@/lib/route";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(() => getMarketplace());
}
