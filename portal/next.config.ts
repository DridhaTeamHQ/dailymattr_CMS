import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output: `next build` emits .next/standalone with its own
   * server.js and only the node_modules the app actually reaches, which is
   * what keeps the deployed image small.
   *
   * Note it traces imports. scripts/scrape_video.py is spawned by path at
   * runtime, not imported, so tracing cannot see it and the Dockerfile copies
   * it in by hand.
   */
  output: "standalone",

  /**
   * Same reasoning as the Turbopack root below, for the production build:
   * there is a lockfile at the repository root as well as in this folder, and
   * without this Next picks one and warns that it may have picked wrong. Being
   * explicit makes the traced file set identical on a laptop and in Docker.
   */
  outputFileTracingRoot: __dirname,

  turbopack: {
    /**
     * Pin the workspace root to this directory.
     *
     * Turbopack infers the root by walking up for lockfiles, and a stray
     * package-lock.json in the user's home directory wins over ours. It then
     * resolves modules from there, so nested dependencies break:
     * `@supabase/supabase-js` loads but its own imports
     * (`@supabase/functions-js` and friends) do not, and every page logs
     * "Module not found" even though the packages are installed correctly.
     */
    root: __dirname,
  },
};

export default nextConfig;
