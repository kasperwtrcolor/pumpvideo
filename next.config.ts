import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `@privy-io/server-auth` pulls in Node-only crypto and JWKS handling. Keep it
   * out of the bundler so it is required natively at runtime instead of being
   * traced/transpiled — without this, route handlers can fail to resolve its
   * crypto dependencies on serverless.
   */
  serverExternalPackages: ["@privy-io/server-auth"],
};

export default nextConfig;