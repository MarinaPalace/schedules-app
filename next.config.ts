import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // All pages are per-user and live, so we render dynamically instead of
  // prerendering a static shell.
  cacheComponents: false,
  serverExternalPackages: ["@electric-sql/pglite", "pdfkit"],
  // Fonts embedded in the schedule PDF are read from disk at runtime.
  outputFileTracingIncludes: { "/schedule/pdf": ["./src/fonts/**"], "/admin/employees/slips": ["./src/fonts/**"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
