// Core HTTP server (docs/05-api.md §1–2): a thin layer over CoreApi. Every rule lives behind CoreApi.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { CoreApi } from "../api-surface.ts";
import { DomainError, toApiError } from "../errors.ts";
import { DEFAULT_MAX_FILE_BYTES, UploadStore } from "./files.ts";
import { registerRoutes } from "./routes.ts";

export const DEFAULT_CORS_ORIGINS = ["http://localhost:3000", "http://localhost:3001"];

export interface HttpServerOptions {
  dataDir: string;
  corsOrigins?: string[];
  /** Per uploaded file. Whole request limit = 10x. */
  maxFileBytes?: number;
}

export function createHttpServer(api: CoreApi, opts: HttpServerOptions): Hono {
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const uploads = new UploadStore(opts.dataDir, maxFileBytes);
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: opts.corsOrigins ?? DEFAULT_CORS_ORIGINS,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: maxFileBytes * 10,
      onError: () => {
        throw new DomainError("VALIDATION", `request body exceeds ${maxFileBytes * 10} bytes`);
      },
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true }));
  registerRoutes(app, api, uploads);

  app.notFound((c) => c.json({ error: { code: "not_found", message: `No route ${c.req.method} ${c.req.path}` } }, 404));
  app.onError((e, c) => {
    const { status, body } = toApiError(e);
    // Message + code + tx hash only: the cause chain can carry signed blobs or adapter internals (#149).
    if (status >= 500) console.error(`[core-http] ${c.req.method} ${c.req.path} ${body.error.code}: ${body.error.message}${body.error.txHash ? ` tx ${body.error.txHash}` : ""}`);
    return c.json(body, status as ContentfulStatusCode);
  });
  return app;
}
