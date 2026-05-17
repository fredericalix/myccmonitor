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
      // OAuth/OIDC/DCR discovery — the MCP SDK probes ALL of these even
      // with a static Bearer configured. Backend returns proper 404 JSON;
      // without these rewrites Next's HTML 404 makes the SDK barf a
      // JSON-parse error in the client. Order matters: most-specific
      // first (left-to-right).
      { source: "/.well-known/:path*", destination: `${BACKEND}/.well-known/:path*` },
      { source: "/register", destination: `${BACKEND}/register` },
      { source: "/authorize", destination: `${BACKEND}/authorize` },
      { source: "/token", destination: `${BACKEND}/token` },
      { source: "/oauth/:path*", destination: `${BACKEND}/oauth/:path*` },
    ];
  },
};

export default nextConfig;
