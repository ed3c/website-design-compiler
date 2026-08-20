import { defineConfig, devices } from "@playwright/test";

const browserPort = process.env.WDC_BROWSER_PORT ?? "3100";
if (!/^\d{1,5}$/.test(browserPort) || Number(browserPort) < 1024 || Number(browserPort) > 65_535) {
  throw new Error("WDC_BROWSER_PORT must be an unprivileged TCP port");
}
const browserBaseUrl = `http://127.0.0.1:${browserPort}`;
const webgpuLaunchArgs = process.platform === "linux"
  ? [
      "--enable-unsafe-webgpu",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--disable-vulkan-surface"
    ]
  : process.platform === "darwin"
    ? ["--enable-unsafe-webgpu", "--use-angle=metal"]
    : ["--enable-unsafe-webgpu"];

export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: ["runtime.spec.ts", "motion-choreography.spec.ts", "media-orchestration.spec.ts", "webgpu.spec.ts"],
  outputDir: "artifacts/browser-qa/test-results-functional",
  reporter: [["json", { outputFile: "artifacts/browser-qa/playwright-report.json" }], ["line"]],
  retries: 0,
  use: {
    baseURL: browserBaseUrl,
    trace: "on",
    screenshot: "off"
  },
  webServer: {
    command: `pnpm --filter @website-design-compiler/site exec next start -H 127.0.0.1 -p ${browserPort}`,
    url: browserBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe"
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        launchOptions: { args: webgpuLaunchArgs }
      }
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
