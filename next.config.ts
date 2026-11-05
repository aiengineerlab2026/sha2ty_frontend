import type { NextConfig } from "next";

// Every API is the FastAPI backend's: /api/* on this site is forwarded there (sessions are its httpOnly cookies, so the
// browser stays on one origin). No API code lives in this app.
const BACKEND_URL = (process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  // Generation, product photos and plan conversion run for minutes (the backend's own timeouts end them).
  experimental: { proxyTimeout: 10 * 60 * 1000 },
  // Dev-only Next.js badge: keep it off the plan sidebar (bottom-left) and its status bar.
  devIndicators: { position: "bottom-right" },
  // The mobile app opens the 3D parts editor from this dev server over the LAN (mobile .env.local EXPO_PUBLIC_WEB_URL).
  allowedDevOrigins: ["192.168.100.4"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "pkqmkxsvphgnxkgtzvsu.supabase.co" }],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
