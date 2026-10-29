import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
