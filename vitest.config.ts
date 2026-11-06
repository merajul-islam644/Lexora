import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web tsconfig uses jsx: "react-jsx"; tests run under this root
  // tsconfig, which has no jsx setting, so pin the automatic transform here.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    // Each test file gets its own throwaway DB via env in tests/setup helpers.
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    maxConcurrency: 1,
    fileParallelism: false
  }
});
