import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5188",
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: "pnpm --filter @marchlands/client dev",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
