import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
