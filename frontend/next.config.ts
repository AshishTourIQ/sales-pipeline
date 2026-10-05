import type { NextConfig } from "next";

// Dev tunnel (scripts/tunnel.ps1): with API_PROXY_TARGET set, Next forwards /api/* to Django,
// so one public URL serves the app and the API (point the NEXT_PUBLIC_*_API vars at /api/...).
const apiProxy = process.env.API_PROXY_TARGET?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Let the tunnel's domain load dev assets and hot reload
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Django routes all end in "/": skip the slash-stripping redirect, and add the slash back below
  // (the :path* match drops it)
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return apiProxy ? [{ source: "/api/:path*", destination: `${apiProxy}/api/:path*/` }] : [];
  },
};

export default nextConfig;
