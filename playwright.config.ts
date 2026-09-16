import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "bun scripts/start-tax-e2e-backend.ts", url: "http://127.0.0.1:8090/api/health", reuseExistingServer: false, timeout: 30_000 },
    { command: "bunx vite --host 127.0.0.1 --port 4173", url: "http://127.0.0.1:4173/login", reuseExistingServer: false, timeout: 30_000 },
  ],
})
