import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The content loader discovers course packs with `readdirSync`, which the
   * build's file tracer cannot follow — it sees no literal path to any of the
   * JSON. Without this, `/api/attempts` deploys without the content it needs
   * to grade and fails at the first request.
   */
  outputFileTracingIncludes: {
    "/api/**": ["./content/**/*.json"],
  },
};

export default nextConfig;
