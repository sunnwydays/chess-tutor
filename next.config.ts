import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/moments reads evals/moments_*.json at runtime; make sure Vercel bundles them.
  outputFileTracingIncludes: { "/api/moments": ["./evals/moments_*.json"] },
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
