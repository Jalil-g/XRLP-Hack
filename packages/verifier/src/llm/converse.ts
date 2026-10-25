// VERIFIER_PROVIDER=nova: Amazon Nova on the Bedrock Converse API, authenticated with the same scoped bearer token.
// Takes the Anthropic-shaped content live.ts/project.ts already build and returns the fields they read, so prompts,
// schemas and verdict logic stay identical across providers. Structured output = one forced tool call.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { bedrockCredentials } from "./client.ts";

const TOOL = "submit_review";

export class ConverseError extends Error {
  constructor(readonly status: number) { super(`Bedrock Converse returned HTTP ${status}.`); }
}

export interface ConverseParsed<T> {
  stop_reason: "end_turn" | "max_tokens" | "refusal" | "incomplete";
  parsed_output: T | null;
  model: string;
}

type ConverseBlock =
  | { text: string }
  | { image: { format: string; source: { bytes: string } } }
  | { document: { format: "pdf" | "txt"; name: string; source: { bytes: string } } };

/** Converse document names allow only alphanumerics, single spaces, hyphens, parentheses and square brackets. */
function documentName(title: string | null | undefined): string {
  return (title ?? "").replace(/[^A-Za-z0-9 ()[\]-]/g, "-").replace(/\s+/g, " ").trim().slice(0, 200) || "document";
}

export function toConverseBlock(block: Anthropic.Beta.BetaContentBlockParam): ConverseBlock {
  if (block.type === "text") return { text: block.text };
  if (block.type === "image" && block.source.type === "base64")
    return { image: { format: block.source.media_type.replace("image/", ""), source: { bytes: block.source.data } } };
  if (block.type === "document" && block.source.type === "base64")
    return { document: { format: "pdf", name: documentName(block.title), source: { bytes: block.source.data } } };
  if (block.type === "document" && block.source.type === "text")
    return { document: { format: "txt", name: documentName(block.title), source: { bytes: Buffer.from(block.source.data, "utf8").toString("base64") } } };
  throw new Error(`Content block ${block.type} is not supported on Converse.`);
}

interface ConverseResponse {
  stopReason?: string;
  output?: { message?: { content?: Array<{ toolUse?: { name?: string; input?: unknown } }> } };
}

export async function converseParse<T>(req: {
  model: string; system: string; content: Anthropic.Beta.BetaContentBlockParam[] | string; schema: z.ZodType<T>;
  maxTokens: number; signal?: AbortSignal; env?: Record<string, string | undefined>;
}): Promise<ConverseParsed<T>> {
  const { region, token } = bedrockCredentials(req.env);
  const { $schema: _, ...json } = z.toJSONSchema(req.schema) as Record<string, unknown>;
  const content = typeof req.content === "string" ? [{ text: req.content }] : req.content.map(toConverseBlock);
  const res = await fetch(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(req.model)}/converse`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      system: [{ text: req.system }],
      messages: [{ role: "user", content }],
      inferenceConfig: { maxTokens: req.maxTokens, temperature: 0 },
      toolConfig: {
        tools: [{ toolSpec: { name: TOOL, description: "Submit the structured review result.", inputSchema: { json } } }],
        toolChoice: { tool: { name: TOOL } },
      },
    }),
    signal: req.signal,
  });
  if (!res.ok) throw new ConverseError(res.status);
  const body = (await res.json()) as ConverseResponse;
  if (body.stopReason === "max_tokens") return { stop_reason: "max_tokens", parsed_output: null, model: req.model };
  if (body.stopReason === "content_filtered" || body.stopReason === "guardrail_intervened") return { stop_reason: "refusal", parsed_output: null, model: req.model };
  const call = body.output?.message?.content?.find((c) => c.toolUse?.name === TOOL)?.toolUse;
  if (!call) return { stop_reason: "incomplete", parsed_output: null, model: req.model };
  const parsed = req.schema.safeParse(call.input);
  return { stop_reason: "end_turn", parsed_output: parsed.success ? parsed.data : null, model: req.model };
}
