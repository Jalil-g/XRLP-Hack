import Anthropic from "@anthropic-ai/sdk";
import { resolveProvider } from "../config.ts";

/** AWS region + bearer token, validated so the token only ever reaches a fixed regional AWS host. */
export function bedrockCredentials(env: Record<string, string | undefined> = process.env): { region: string; token: string } {
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
  if (!region || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) throw new Error("A valid AWS_REGION is required for Bedrock.");
  if (!env.AWS_BEARER_TOKEN_BEDROCK) throw new Error("AWS_BEARER_TOKEN_BEDROCK is required for Bedrock.");
  return { region, token: env.AWS_BEARER_TOKEN_BEDROCK };
}

/** Native Bedrock Messages endpoint: same prompts/schema, AWS billing/authentication. */
export function liveClientOptions(env: Record<string, string | undefined> = process.env): NonNullable<ConstructorParameters<typeof Anthropic>[0]> {
  const common = { timeout: 20_000, maxRetries: 0 };
  const provider = resolveProvider(env);
  if (provider === "nova") throw new Error("VERIFIER_PROVIDER=nova uses the Bedrock Converse API, not the Anthropic client.");
  if (provider === "anthropic") {
    if (env.ANTHROPIC_API_KEY?.startsWith("bedrock-api-key-")) throw new Error("AWS credentials must only be sent to the Bedrock provider.");
    return { ...common, apiKey: env.ANTHROPIC_API_KEY };
  }
  const { region, token } = bedrockCredentials(env);
  return { ...common, baseURL: `https://bedrock-mantle.${region}.api.aws/anthropic`,
    apiKey: token, authToken: null };
}

export function createLiveClient(): Anthropic { return new Anthropic(liveClientOptions()); }
