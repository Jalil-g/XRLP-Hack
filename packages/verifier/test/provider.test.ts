import assert from "node:assert/strict";
import { test } from "node:test";
import { liveCredentialsAvailable, resolveProvider } from "../src/config.ts";
import { liveClientOptions } from "../src/llm/client.ts";

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
