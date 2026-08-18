import { defineConfig, devices } from "@playwright/test";

const storybookPort = process.env.WDC_STORYBOOK_PORT ?? "6106";
if (!/^\d{1,5}$/.test(storybookPort) || Number(storybookPort) < 1024 || Number(storybookPort) > 65_535) {
  throw new Error("WDC_STORYBOOK_PORT must be an unprivileged TCP port");
}
const storybookBaseUrl = `http://127.0.0.1:${storybookPort}`;

export default defineConfig({
  testDir: "./tests/storybook",
  outputDir: "artifacts/storybook/test-results",
  reporter: [["json", { outputFile: "artifacts/storybook/playwright-report.json" }], ["line"]],
  retries: 0,
  use: {
    baseURL: storybookBaseUrl,
    trace: "on",
    screenshot: "off"
  },
  webServer: {
    command: `pnpm --filter @website-design-compiler/site exec storybook dev --ci --host 127.0.0.1 --port ${storybookPort}`,
    url: storybookBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe"
  },
  projects: [
    { name: "storybook-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "storybook-mobile", use: { ...devices["Pixel 7"] } }
  ]
});
