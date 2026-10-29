import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    projects: [
      { extends: true, test: { name: "rebuild", exclude: ["c1.schedules-webhooks.test.ts"] } },
      {
        extends: true,
        test: {
          name: "c1",
          include: ["c1.schedules-webhooks.test.ts"],
          testTimeout: 300_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
