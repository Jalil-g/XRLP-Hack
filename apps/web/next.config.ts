import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @xrlp/shared ships raw .ts (with .ts import extensions) — let Next compile it.
  transpilePackages: ["@xrlp/shared"],
  reactStrictMode: true,
};

export default nextConfig;
