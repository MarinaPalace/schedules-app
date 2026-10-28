import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // All pages are per-user and live, so we render dynamically instead of
  // prerendering a static shell.
  cacheComponents: false,
  serverExternalPackages: ["@electric-sql/pglite"],
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
