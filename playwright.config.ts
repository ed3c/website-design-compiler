import { defineConfig, devices } from "@playwright/test";

const browserPort = process.env.WDC_BROWSER_PORT ?? "3100";
if (!/^\d{1,5}$/.test(browserPort) || Number(browserPort) < 1 || Number(browserPort) > 65_535) {
  throw new Error("WDC_BROWSER_PORT must be an integer from 1 through 65535");
}
const browserBaseUrl = `http://127.0.0.1:${browserPort}`;

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "artifacts/browser-qa/test-results",
  reporter: [["json", { outputFile: "artifacts/browser-qa/playwright-report.json" }], ["line"]],
  retries: 0,
  use: {
    baseURL: browserBaseUrl,
    trace: "on",
    screenshot: "off"
  },
  webServer: {
    command: `pnpm --filter @website-design-compiler/site start --port ${browserPort}`,
    url: browserBaseUrl,
    reuseExistingServer: false,
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
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } }
    }
  ]
});
