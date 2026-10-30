import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only Next.js badge: keep it off the plan sidebar (bottom-left) and its status bar.
  devIndicators: { position: "bottom-right" },
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
