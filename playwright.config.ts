import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "artifacts/browser-qa/test-results",
  reporter: [["json", { outputFile: "artifacts/browser-qa/playwright-report.json" }], ["line"]],
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on",
    screenshot: "off"
  },
  webServer: {
    command: "pnpm --filter @website-design-compiler/site start --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe"
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } }
    },
    {
      name: "tablet-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } }
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] }
    },
    {
      name: "reduced-motion-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce"
      }
    }
  ]
});
