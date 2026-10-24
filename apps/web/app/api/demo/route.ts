// GET  /api/demo            → DemoState
// POST /api/demo { action } → DemoResult
import { getDemoState, runDemoAction } from "@/lib/api";
import { body, handle } from "@/lib/route";
import type { DemoAction } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(() => getDemoState());
}

export async function POST(req: Request) {
  return handle(async () => runDemoAction((await body<{ action: DemoAction }>(req)).action));
}
