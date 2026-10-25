import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// One .env at the repo root drives every app (see .env.example). Existing env vars win over the file.
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// .env.example puts comments after values; strip them so "mock   # mock | http" reads as "mock".
const env = (name: string) => process.env[name]?.split("#")[0]?.trim() || undefined;
const apiMode = env("NEXT_PUBLIC_API_MODE") === "http" ? "http" : "mock";
const coreUrl = (env("CORE_URL") ?? "http://localhost:4000").replace(/\/$/, "");
// http mode autofills the inspector's attestation tx against this node before signing it in the browser (INS-04).
const xrplWsUrl = env("XRPL_WS_URL") ?? "wss://s.devnet.rippletest.net:51233";

const nextConfig: NextConfig = {
  // Workspace packages ship raw .ts (with .ts import extensions) — let Next compile them.
  transpilePackages: ["@xrlp/shared", "@xrlp/attest-signer"],
  reactStrictMode: true,
  env: { NEXT_PUBLIC_API_MODE: apiMode, CORE_URL: coreUrl, NEXT_PUBLIC_XRPL_WS_URL: xrplWsUrl },
  // http mode: the browser calls same-origin /api/*, Next proxies to core (docs/05-api.md topology).
  async rewrites() {
    return apiMode === "http" ? [{ source: "/api/:path*", destination: `${coreUrl}/api/:path*` }] : [];
  },
};

export default nextConfig;
