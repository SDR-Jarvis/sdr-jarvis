import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/email/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    environment: "node",
  },
});
