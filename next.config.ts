import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/card/\\[handle\\]/\\[style\\]": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/card/prepare": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
