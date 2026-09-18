import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  experimental: {
    useTypeScriptCli: false
  },
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: { "/api/analyze": ["./public/demo_data/*.png"] },
  serverExternalPackages: ["sharp", "geotiff", "proj4", "geotiff-geokeys-to-proj4"],
  reactStrictMode: true
};

export default nextConfig;
