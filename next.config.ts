import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Keystatic's GitHub mode redirects local dev to 127.0.0.1 for the OAuth callback.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
