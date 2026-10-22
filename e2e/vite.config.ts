import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    globalSetup: ["./setup.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 90_000,
    reporters: ["verbose", "json"],
    outputFile: "results.json",
  },
});
