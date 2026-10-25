// Read-only access to the verifier's published demo evidence (packages/verifier/fixtures/evidence, CC0 / public-domain
// photos with synthetic EXIF; see its SOURCES.txt). Inspector mock mode shows these instead of drawn stand-ins (mirrors apps/web/app/fixture-files).
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "../../packages/verifier/fixtures/evidence");
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf" };

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const file = path.resolve(ROOT, ...parts.map(decodeURIComponent));
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type || !file.startsWith(ROOT + path.sep)) return new Response("not found", { status: 404 });
  try {
    return new Response(new Uint8Array(await readFile(file)), { headers: { "content-type": type, "cache-control": "public, max-age=3600" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
