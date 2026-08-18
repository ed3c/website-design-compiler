import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const categories=["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"] as const;
for(const category of categories){
  test(`${category} generated page preserves semantic order and responsive containment`,async({page},testInfo)=>{
    const response=await page.goto(`/benchmarks/${category}`,{waitUntil:"networkidle"});
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator(`[data-generated-page='${category}']`)).toBeVisible();
    const nodes=page.locator("[data-page-node]");
    expect(await nodes.count()).toBeGreaterThanOrEqual(5);
    const indices=await nodes.evaluateAll((entries)=>entries.map((entry)=>Number(entry.getAttribute("data-semantic-index"))));
    expect(indices).toEqual(indices.map((_,index)=>index));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    expect(overflow).toBe(false);
    const expectedLayoutAttribute=testInfo.project.name.startsWith("mobile")?"data-mobile-layout":testInfo.project.name.startsWith("tablet")?"data-tablet-layout":"data-desktop-layout";
    expect(await nodes.first().getAttribute(expectedLayoutAttribute)).toBeTruthy();
    if(!testInfo.project.name.startsWith("reduced-motion")){
      const directory=join(process.cwd(),"artifacts","generated-pages","screenshots");
      await mkdir(directory,{recursive:true});
      await page.screenshot({path:join(directory,`${testInfo.project.name}--${category}.png`),fullPage:true});
      const visualQuality = await page.evaluate(() => {
        const parseRgb = (value: string): [number, number, number] | null => {
          const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
        };
        const luminance = (rgb: [number, number, number]) => {
          const channels = rgb.map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
          });
          return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
        };
        const contrast = (foreground: string, background: string) => {
          const fg = parseRgb(foreground);
          const bg = parseRgb(background);
          if (!fg || !bg) return null;
          const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
          return (light! + 0.05) / (dark! + 0.05);
        };
        const nodes = [...document.querySelectorAll<HTMLElement>("[data-page-node]")];
        const textElements = [...document.querySelectorAll<HTMLElement>("h1,h2,h3,p,a,button,li")]
          .filter((element) => element.textContent?.trim() && element.getClientRects().length > 0);
        const bodyStyle = getComputedStyle(document.body);
        const headingSizes = [...document.querySelectorAll<HTMLElement>("h1,h2,h3")].map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        const bodySize = Number.parseFloat(bodyStyle.fontSize);
        const contrasts = textElements.flatMap((element) => {
          const style = getComputedStyle(element);
          let parent: HTMLElement | null = element;
          let background = "";
          while (parent) {
            const candidate = getComputedStyle(parent).backgroundColor;
            if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") { background = candidate; break; }
            parent = parent.parentElement;
          }
          const ratio = contrast(style.color, background || bodyStyle.backgroundColor);
          return ratio === null ? [] : [ratio];
        });
        const nodeStyles = nodes.map((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return { kind: node.dataset.pageNode ?? "unknown", background: style.backgroundColor, top: rect.top, bottom: rect.bottom };
        });
        const verticalGaps = nodeStyles.slice(1).map((entry, index) => Math.max(0, entry.top - nodeStyles[index]!.bottom));
        const distinctBackgrounds = new Set(nodeStyles.map((entry) => entry.background).filter((value) => value !== "rgba(0, 0, 0, 0)" && value !== "transparent")).size;
        const sectionTransitions = nodeStyles.slice(1).filter((entry, index) => entry.background !== nodeStyles[index]!.background).length;
        return {
          schema: "website-design-compiler/generated-page-visual-observation/v1",
          viewport: { width: window.innerWidth, height: window.innerHeight },
          nodeCount: nodes.length,
          sectionKinds: nodeStyles.map((entry) => entry.kind),
          typography: {
            families: [...new Set(textElements.map((element) => getComputedStyle(element).fontFamily))].sort(),
            headingToBodyRatio: bodySize > 0 && headingSizes.length > 0 ? Math.max(...headingSizes) / bodySize : 0,
            distinctHeadingSizes: new Set(headingSizes).size
          },
          contrast: { minimumRatio: contrasts.length > 0 ? Math.min(...contrasts) : 0, sampleCount: contrasts.length },
          rhythm: {
            averageVerticalGap: verticalGaps.length > 0 ? verticalGaps.reduce((sum, value) => sum + value, 0) / verticalGaps.length : 0,
            distinctBackgrounds,
            sectionTransitions
          },
          ctaCount: document.querySelectorAll("a[href],button:not([disabled])").length,
          clippedTextCount: textElements.filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1).length
        };
      });
      const observationDirectory=join(process.cwd(),"artifacts","generated-pages","observations");
      await mkdir(observationDirectory,{recursive:true});
      await writeFile(join(observationDirectory,`${testInfo.project.name}--${category}.json`),`${JSON.stringify({...visualQuality,category,project:testInfo.project.name},null,2)}\n`,`utf8`);
    }
  });
}
