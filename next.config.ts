import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};

export default nextConfig;
