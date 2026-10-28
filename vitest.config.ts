import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Each test file gets its own throwaway DB via env in tests/setup helpers.
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    maxConcurrency: 1,
    fileParallelism: false
  }
});
