import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded at runtime only when ENABLE_PLAYWRIGHT=true; never bundled.
  serverExternalPackages: ["playwright-core"],
  // A stray package-lock.json in a parent folder would otherwise be picked as the workspace root.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
