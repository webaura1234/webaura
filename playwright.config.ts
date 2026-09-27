import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;
// Set once in the main process; workers inherit it, so everyone shares one fresh DB per run.
process.env.E2E_DB ??= path.resolve("tests", ".tmp", `e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "tests/.tmp/results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { SQLITE_PATH: process.env.E2E_DB },
  },
  projects: [
    { name: "api", testMatch: /api\.spec\.ts/ },
    { name: "android-chrome", testMatch: /ui\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    { name: "iphone-webkit", testMatch: /ui\.spec\.ts/, use: { ...devices["iPhone 14"] } },
    { name: "desktop-chrome", testMatch: /ui\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", testMatch: /ui\.spec\.ts/, use: { ...devices["Desktop Firefox"] } },
    { name: "perf", testMatch: /perf\.spec\.ts/, use: { ...devices["Pixel 7"] } },
  ],
});
