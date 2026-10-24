import { renderEvidenceSvg } from "@/lib/evidence-art";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const svg = renderEvidenceSvg(file);
  if (!svg) return new Response("not found", { status: 404 });
  return new Response(svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" },
  });
}
