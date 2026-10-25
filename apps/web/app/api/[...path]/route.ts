// Mock-mode backend for /api/* (browser calls). In http mode next.config.ts rewrites /api/* to CORE_URL before this runs.
import { API_MODE, ApiError } from "@/lib/api";
import { handleMock, mockFile } from "@/lib/mock/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function respond(req: Request, ctx: Ctx): Promise<Response> {
  if (API_MODE !== "mock") {
    return Response.json(new ApiError("unreachable", "API mode is http but the request reached the mock; check CORE_URL rewrites", 502).toBody(), { status: 502 });
  }
  const { path } = await ctx.params;
  const url = new URL(req.url);
  try {
    if (req.method === "GET" && path[0] === "files" && path[1]) return file(decodeURIComponent(path[1]), req.url);
    const contentType = req.headers.get("content-type") ?? "";
    const body = req.method === "GET" ? undefined : contentType.includes("multipart/form-data") ? await req.formData() : await req.json().catch(() => undefined);
    const data = await handleMock({ method: req.method as "GET" | "POST", path: `/api/${path.map(encodeURIComponent).join("/")}${url.search}`, body });
    return Response.json(data);
  } catch (err) {
    if (err instanceof ApiError) return Response.json(err.toBody(), { status: err.status });
    console.error(err);
    return Response.json(new ApiError("unknown", err instanceof Error ? err.message : "Mock backend error", 500).toBody(), { status: 500 });
  }
}

function file(fileId: string, base: string): Response {
  const e = mockFile(fileId);
  if (!e) return new Response("not found", { status: 404 });
  const data = /^data:([^;]+);base64,(.*)$/.exec(e.uri);
  if (data) return new Response(Buffer.from(data[2]!, "base64"), { headers: { "content-type": data[1]! } });
  return Response.redirect(new URL(e.uri, base), 307);
}

export const GET = respond;
export const POST = respond;
