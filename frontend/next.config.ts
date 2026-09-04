import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  experimental: {
    useTypeScriptCli: false
  },
  outputFileTracingRoot: __dirname,
  reactStrictMode: true
};

export default nextConfig;
