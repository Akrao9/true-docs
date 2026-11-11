import { defineConfig } from "vitest/config";

// Matches convex-test's own config: edge-runtime environment + inlining convex-test,
// otherwise `import.meta.glob` is not available to it.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
  },
});
