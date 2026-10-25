import type { NextConfig } from "next";

const API_MODE = process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";
const CORE_URL = process.env.CORE_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // @xrlp/shared ships raw .ts (with .ts import extensions) — let Next compile it.
  transpilePackages: ["@xrlp/shared"],
  reactStrictMode: true,
  // http mode: the browser's /api/* goes straight to core (beforeFiles wins over app/api/[...path], the mock backend).
  async rewrites() {
    return API_MODE === "http" ? { beforeFiles: [{ source: "/api/:path*", destination: `${CORE_URL}/api/:path*` }], afterFiles: [], fallback: [] } : [];
  },
};

export default nextConfig;
