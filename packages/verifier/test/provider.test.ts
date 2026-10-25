import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod/v4";
import { liveCredentialsAvailable, NOVA_DEFAULT_MODEL, resolveModel, resolveProvider } from "../src/config.ts";
import { liveClientOptions } from "../src/llm/client.ts";
import { ConverseError, converseParse, toConverseBlock } from "../src/llm/converse.ts";

test("AWS bearer tokens route only to the fixed regional AWS endpoint with no retries", () => {
  const options = liveClientOptions({ VERIFIER_PROVIDER: "bedrock", AWS_REGION: "us-west-2", AWS_BEARER_TOKEN_BEDROCK: "unit-test-placeholder" });
  assert.equal(options.baseURL, "https://bedrock-mantle.us-west-2.api.aws/anthropic");
  assert.equal(options.apiKey, "unit-test-placeholder");
  assert.equal(options.authToken, null);
  assert.equal(options.maxRetries, 0);
  assert.equal(options.timeout, 20_000);
});

test("wrong provider, malformed region and missing AWS key fail closed", () => {
  assert.throws(() => liveClientOptions({ VERIFIER_PROVIDER: "unknown" }));
  assert.throws(() => liveClientOptions({ VERIFIER_PROVIDER: "bedrock", AWS_REGION: "us-west-2.evil.example", AWS_BEARER_TOKEN_BEDROCK: "unit-test-placeholder" }));
  assert.throws(() => liveClientOptions({ VERIFIER_PROVIDER: "bedrock", AWS_REGION: "us-west-2" }));
  assert.throws(() => liveClientOptions({ ANTHROPIC_API_KEY: "bedrock-api-key-unit-test-placeholder" }));
});

test("credentials are checked for the selected provider, never borrowed from another service", () => {
  assert.equal(resolveProvider({}), "anthropic");
  assert.equal(liveCredentialsAvailable({ VERIFIER_PROVIDER: "bedrock", ANTHROPIC_API_KEY: "unit-test-placeholder" }), false);
  assert.equal(liveCredentialsAvailable({ VERIFIER_PROVIDER: "bedrock", AWS_BEARER_TOKEN_BEDROCK: "unit-test-placeholder" }), true);
  assert.equal(liveCredentialsAvailable({ AWS_BEARER_TOKEN_BEDROCK: "unit-test-placeholder" }), false);
});

test("nova uses the AWS bearer token, a Nova model id, and never the Anthropic client", () => {
  assert.equal(resolveProvider({ VERIFIER_PROVIDER: "nova" }), "nova");
  assert.equal(liveCredentialsAvailable({ VERIFIER_PROVIDER: "nova", ANTHROPIC_API_KEY: "unit-test-placeholder" }), false);
  assert.equal(liveCredentialsAvailable({ VERIFIER_PROVIDER: "nova", AWS_BEARER_TOKEN_BEDROCK: "unit-test-placeholder" }), true);
  assert.throws(() => liveClientOptions({ VERIFIER_PROVIDER: "nova", AWS_REGION: "us-east-2", AWS_BEARER_TOKEN_BEDROCK: "unit-test-placeholder" }), /Converse/);
  const saved = { provider: process.env.VERIFIER_PROVIDER, model: process.env.VERIFIER_MODEL };
  try {
    process.env.VERIFIER_PROVIDER = "nova";
    process.env.VERIFIER_MODEL = "claude-opus-5-5";
    assert.equal(resolveModel(), NOVA_DEFAULT_MODEL);
    assert.equal(resolveModel("us.amazon.nova-pro-v1:0"), "us.amazon.nova-pro-v1:0");
  } finally {
    for (const [key, value] of [["VERIFIER_PROVIDER", saved.provider], ["VERIFIER_MODEL", saved.model]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("Converse blocks: images and PDFs pass through as base64, text documents are encoded, names are sanitized", () => {
  assert.deepEqual(toConverseBlock({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } }),
    { image: { format: "jpeg", source: { bytes: "QUJD" } } });
  assert.deepEqual(toConverseBlock({ type: "document", title: "ev_invoice.1", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } }),
    { document: { format: "pdf", name: "ev-invoice-1", source: { bytes: "QUJD" } } });
  assert.deepEqual(toConverseBlock({ type: "document", title: "ev_2", source: { type: "text", media_type: "text/plain", data: "ABC" } }),
    { document: { format: "txt", name: "ev-2", source: { bytes: "QUJD" } } });
});

const Out = z.object({ result: z.enum(["pass", "fail"]) });
const env = { AWS_REGION: "us-east-2", AWS_BEARER_TOKEN_BEDROCK: "unit-test-placeholder" };
async function withFetch<T>(reply: (url: string, init: RequestInit) => Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => reply(String(url), init ?? {})) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("converseParse forces one tool call to the fixed regional host and validates its input", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const ok = (input: unknown) => (url: string, init: RequestInit) => {
    seen = { url, init };
    return Response.json({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_review", input } }] } } });
  };
  const res = await withFetch(ok({ result: "pass" }), () => converseParse({ model: "global.amazon.nova-2-lite-v1:0", system: "s", content: "u", schema: Out, maxTokens: 10, env }));
  assert.deepEqual(res, { stop_reason: "end_turn", parsed_output: { result: "pass" }, model: "global.amazon.nova-2-lite-v1:0" });
  assert.equal(seen!.url, "https://bedrock-runtime.us-east-2.amazonaws.com/model/global.amazon.nova-2-lite-v1%3A0/converse");
  assert.equal((seen!.init.headers as Record<string, string>).authorization, "Bearer unit-test-placeholder");
  const body = JSON.parse(String(seen!.init.body));
  assert.deepEqual(body.toolConfig.toolChoice, { tool: { name: "submit_review" } });
  assert.equal(body.toolConfig.tools[0].toolSpec.inputSchema.json.$schema, undefined);

  const bad = await withFetch(ok({ result: "maybe" }), () => converseParse({ model: "m", system: "s", content: "u", schema: Out, maxTokens: 10, env }));
  assert.equal(bad.parsed_output, null);
});

test("converseParse maps truncation, content filters and HTTP errors without leaking a verdict", async () => {
  const stop = (stopReason: string) => () => Response.json({ stopReason, output: { message: { content: [] } } });
  const call = () => converseParse({ model: "m", system: "s", content: "u", schema: Out, maxTokens: 10, env });
  assert.equal((await withFetch(stop("max_tokens"), call)).stop_reason, "max_tokens");
  assert.equal((await withFetch(stop("content_filtered"), call)).stop_reason, "refusal");
  assert.equal((await withFetch(stop("end_turn"), call)).stop_reason, "incomplete");
  await assert.rejects(withFetch(() => new Response("{}", { status: 403 }), call), (e: unknown) => e instanceof ConverseError && e.status === 403);
  await assert.rejects(converseParse({ model: "m", system: "s", content: "u", schema: Out, maxTokens: 10, env: { ...env, AWS_REGION: "us-east-2.evil.example" } }));
});
