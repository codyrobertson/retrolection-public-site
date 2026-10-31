import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Keystatic's GitHub mode redirects local dev to 127.0.0.1 for the OAuth callback.
  allowedDevOrigins: ["127.0.0.1"],
  // Case studies became projects; keep old links working.
  async redirects() {
    return [{ source: "/work/:path*", destination: "/projects/:path*", permanent: true }];
  },
};

export default nextConfig;
