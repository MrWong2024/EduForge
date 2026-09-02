import { defineConfig } from "@playwright/test";

const testPort = (name: string, fallback: number): number => {
  const value = process.env[name] ?? String(fallback);
  const port = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    port === 3000 ||
    port === 5000
  ) {
    throw new Error(`${name} must be a dedicated port between 1024 and 65535 (excluding 3000/5000)`);
  }
  return port;
};

const frontendPort = testPort("EDUFORGE_BROWSER_FRONTEND_PORT", 3100);
const upstreamPort = testPort("EDUFORGE_BROWSER_UPSTREAM_PORT", 5100);
if (frontendPort === upstreamPort) {
  throw new Error("Browser frontend and upstream ports must differ");
}

const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const upstreamOrigin = `http://127.0.0.1:${upstreamPort}`;

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  globalTimeout: 180_000,
  expect: { timeout: 5_000 },
  reporter: "dot",
  outputDir: "./test-results/browser",
  preserveOutput: "never",
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: frontendOrigin,
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
  },
  webServer: [
    {
      name: "Probe upstream",
      command: "node test/browser/support/browser-probe-upstream.mjs",
      url: `${upstreamOrigin}/health`,
      env: { EDUFORGE_BROWSER_UPSTREAM_PORT: String(upstreamPort) },
      reuseExistingServer: false,
      timeout: 10_000,
      stdout: "pipe",
    },
    {
      name: "Next BFF",
      command: `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${frontendPort}`,
      url: `${frontendOrigin}/api/proxy/__browser_probe__/cookie/echo`,
      env: {
        FRONTEND_BACKEND_ORIGIN: upstreamOrigin,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
    },
  ],
});
