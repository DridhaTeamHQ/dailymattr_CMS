import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      /**
       * Advice, not a defect — so it warns rather than failing the build.
       *
       * The rule objects to any setState in an effect body. Every occurrence
       * here is the same legitimate shape: flipping state at the start of async
       * work (useQuery's `setLoading(true)`), or reading something that only
       * exists in the browser and cannot be known while rendering on the server
       * — the theme provider resolving `prefers-color-scheme`, the login page
       * reading an error out of the query string.
       *
       * Satisfying it would mean restructuring useQuery and the theme provider,
       * which are load-bearing, for no behavioural gain. That is a change worth
       * making deliberately rather than to turn a CI step green, so it stays
       * visible as a warning instead of being switched off.
       *
       * The rules in the same family that do catch defects stay as errors:
       * react-hooks/purity found Math.random() in a render path, and
       * exhaustive-deps found a stale closure that reset the voice picker.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
