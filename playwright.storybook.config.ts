import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/storybook",
  outputDir: "artifacts/storybook/test-results",
  reporter: [["json", { outputFile: "artifacts/storybook/playwright-report.json" }], ["line"]],
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:6006",
    trace: "on",
    screenshot: "off"
  },
  webServer: {
    command: "pnpm --filter @website-design-compiler/site storybook",
    url: "http://127.0.0.1:6006",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe"
  },
  projects: [
    { name: "storybook-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "storybook-mobile", use: { ...devices["Pixel 7"] } }
  ]
});
