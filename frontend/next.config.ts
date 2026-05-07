import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/auth/:path*", destination: `${BACKEND}/auth/:path*` },
      { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
      { source: "/webhooks/:path*", destination: `${BACKEND}/webhooks/:path*` },
      { source: "/ws", destination: `${BACKEND}/ws` },
    ];
  },
};

export default nextConfig;
