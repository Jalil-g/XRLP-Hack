// `pnpm --filter @xrlp/core serve` -> core HTTP API on :4000 (PORT, CORS_ORIGINS, DATA_DIR). KEEPER=1 -> keeper every 30 s.
import { serve } from "@hono/node-server";
import type { CoreApi } from "../api-surface.ts";
import { createCore } from "../factory.ts";
import { createHttpServer, DEFAULT_CORS_ORIGINS } from "./app.ts";
import { resolveDataDir } from "../file-store.ts";
import { keeperIntervalFromEnv, startKeeper } from "../keeper.ts";

const core = createCore();
const api: CoreApi = core.service;

const port = Number(process.env.PORT ?? 4000);
const corsOrigins = process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_CORS_ORIGINS;
const app = createHttpServer(api, { dataDir: core.dataDir ?? resolveDataDir(process.env), corsOrigins });
serve({ fetch: app.fetch, port }, (info) => console.log(`[core-http] listening on http://localhost:${info.port} (CORS: ${corsOrigins.join(", ")})`));

const keeperMs = keeperIntervalFromEnv(process.env);
if (keeperMs) {
  startKeeper(api, { intervalMs: keeperMs });
  console.log(`[keeper] running every ${keeperMs / 1000}s (expire -> EscrowCancel -> refund LoanPay; retries releases)`);
}
