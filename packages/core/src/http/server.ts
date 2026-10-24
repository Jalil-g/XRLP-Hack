// `pnpm --filter @xrlp/core serve` -> core HTTP API on :4000 (PORT, CORS_ORIGINS, DATA_DIR).
import { serve } from "@hono/node-server";
import type { CoreApi } from "../api-surface.ts";
import { createCore } from "../factory.ts";
import { createHttpServer, DEFAULT_CORS_ORIGINS } from "./app.ts";
import { resolveDataDir } from "../file-store.ts";

// Wiring point for CORE-03: CoreService must implement CoreApi. Until then this fails fast with a clear message.
const core = createCore();
const api = core.service as unknown as CoreApi;
const missing = ["listProjects", "getProject", "runChecks", "tryStealDemo"].filter((m) => typeof (api as unknown as Record<string, unknown>)[m] !== "function");
if (missing.length) throw new Error(`CoreService does not implement CoreApi yet (missing ${missing.join(", ")}) — lands in CORE-03`);

const port = Number(process.env.PORT ?? 4000);
const corsOrigins = process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_CORS_ORIGINS;
const app = createHttpServer(api, { dataDir: core.dataDir ?? resolveDataDir(process.env), corsOrigins });
serve({ fetch: app.fetch, port }, (info) => console.log(`[core-http] listening on http://localhost:${info.port} (CORS: ${corsOrigins.join(", ")})`));
