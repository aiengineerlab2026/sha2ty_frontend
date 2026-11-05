import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
