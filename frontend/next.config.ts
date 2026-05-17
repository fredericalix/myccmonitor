import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/auth/:path*", destination: `${BACKEND}/auth/:path*` },
      { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
      { source: "/webhooks/:path*", destination: `${BACKEND}/webhooks/:path*` },
      { source: "/ws", destination: `${BACKEND}/ws` },
      { source: "/mcp", destination: `${BACKEND}/mcp` },
      { source: "/mcp/:path*", destination: `${BACKEND}/mcp/:path*` },
      // OAuth discovery — the MCP SDK probes these and chokes on Next's 404
      // HTML page. Backend returns proper 404 JSON instead.
      { source: "/.well-known/:path*", destination: `${BACKEND}/.well-known/:path*` },
    ];
  },
};

export default nextConfig;
