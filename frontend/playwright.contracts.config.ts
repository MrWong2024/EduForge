import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/contracts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: "dot",
  outputDir: "./test-results/contracts",
  preserveOutput: "never",
});
