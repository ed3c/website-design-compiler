import { defineConfig,devices } from "@playwright/test";

const browserPort=Number(process.env.WDC_BROWSER_PORT??"3000");
if(!Number.isInteger(browserPort)||browserPort<1024||browserPort>65535)throw new Error("WDC_BROWSER_PORT must be an unprivileged TCP port");
const webgpuLaunchArgs=process.platform==="linux"
  ?["--enable-unsafe-webgpu","--use-angle=vulkan","--enable-features=Vulkan","--disable-vulkan-surface"]
  :process.platform==="darwin"
    ?["--enable-unsafe-webgpu","--use-angle=metal"]
    :["--enable-unsafe-webgpu"];

export default defineConfig({
  testDir:"./tests/browser",
  testMatch:["runtime.spec.ts","motion-choreography.spec.ts","media-orchestration.spec.ts","webgpu.spec.ts"],
  workers:1,
  outputDir:"artifacts/browser-qa/test-results-runtime",
  reporter:[["json",{outputFile:"artifacts/browser-qa/playwright-runtime-report.json"}],["line"]],
  retries:0,
  use:{baseURL:`http://127.0.0.1:${browserPort}`,trace:"on",screenshot:"off"},
  webServer:{command:`pnpm --filter @website-design-compiler/site exec next start -H 127.0.0.1 -p ${browserPort}`,url:`http://127.0.0.1:${browserPort}`,reuseExistingServer:false,timeout:120_000,stdout:"ignore",stderr:"pipe"},
  projects:[
    {name:"desktop-chromium",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:1000},launchOptions:{args:webgpuLaunchArgs}}},
    {name:"tablet-chromium",use:{...devices["Desktop Chrome"],viewport:{width:768,height:1024}}},
    {name:"mobile-chromium",use:{...devices["Pixel 7"]}},
    {name:"reduced-motion-chromium",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:1000}}}
  ]
});
