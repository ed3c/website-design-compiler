import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARENA_CATEGORIES } from "../../src/arena.js";

type ContrastTarget = {
  color: string;
  fontSize: number;
  fontWeight: number;
  label: string;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
};

async function measureRenderedContrast(page: Page): Promise<{
  minimumRatio: number;
  sampleCount: number;
  violationCount: number;
  worst: { label: string; ratio: number; required: number; foreground: string; background: string } | null;
}> {
  const targets = await page.evaluate(() => {
    const acceptedContainers = new Set(document.querySelectorAll<HTMLElement>("h1,h2,h3,p,a,button,li"));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return node.textContent?.trim() && parent?.closest("h1,h2,h3,p,a,button,li") && parent.getClientRects().length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    return textNodes.map((node) => {
      const element = node.parentElement!;
      element.dataset.wdcContrastSample = "";
      const container = acceptedContainers.has(element)
        ? element
        : element.closest<HTMLElement>("h1,h2,h3,p,a,button,li") ?? element;
      const style = getComputedStyle(element);
      const range = document.createRange();
      range.selectNode(node);
      return {
        color: style.color,
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
        label: `${container.tagName.toLowerCase()}${container.className ? `.${String(container.className).trim().replaceAll(" ", ".")}` : ""}: ${node.textContent?.trim().slice(0, 100) ?? ""}`,
        rects: [...range.getClientRects()].map((rect) => ({
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height
        }))
      };
    });
  });
  const hiddenTextStyle = await page.addStyleTag({ content: `
    [data-wdc-contrast-sample] {
      color: transparent !important;
      text-decoration-color: transparent !important;
      text-shadow: none !important;
    }
  ` });
  let backgroundScreenshot: Buffer;
  try {
    backgroundScreenshot = await page.screenshot({ fullPage: true });
  } finally {
    await hiddenTextStyle.evaluate((element) => element.parentNode?.removeChild(element));
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>("[data-wdc-contrast-sample]")) {
        delete element.dataset.wdcContrastSample;
      }
    });
  }

  return await page.evaluate(async ({ imageBase64, targets }) => {
    type Rgba = [number, number, number, number];
    const image = new Image();
    image.src = `data:image/png;base64,${imageBase64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("browser canvas is unavailable for rendered contrast evidence");
    context.drawImage(image, 0, 0);
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
    if (!colorContext) throw new Error("browser canvas is unavailable for CSS color evidence");
    const parseCssColor = (value: string): Rgba => {
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = value;
      colorContext.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
      return [red!, green!, blue!, alpha! / 255];
    };
    const composite = (foreground: Rgba, background: Rgba): Rgba => [
      foreground[0] * foreground[3] + background[0] * (1 - foreground[3]),
      foreground[1] * foreground[3] + background[1] * (1 - foreground[3]),
      foreground[2] * foreground[3] + background[2] * (1 - foreground[3]),
      1
    ];
    const luminance = (color: Rgba) => [color[0], color[1], color[2]]
      .map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const scaleX = image.naturalWidth / documentWidth;
    const scaleY = image.naturalHeight / documentHeight;
    const samples = (targets as ContrastTarget[]).flatMap((target) => {
      const foreground = parseCssColor(target.color);
      const required = target.fontSize >= 24 || (target.fontSize >= 18.66 && target.fontWeight >= 700) ? 3 : 4.5;
      return target.rects.flatMap((rect) => {
        if (rect.width <= 0 || rect.height <= 0) return [];
        const samples = [
          [rect.x + rect.width * 0.25, rect.y + rect.height * 0.5],
          [rect.x + rect.width * 0.5, rect.y + rect.height * 0.5],
          [rect.x + rect.width * 0.75, rect.y + rect.height * 0.5]
        ];
        return samples.map(([x, y]) => {
          const pixelX = Math.max(0, Math.min(image.naturalWidth - 1, Math.round(x! * scaleX)));
          const pixelY = Math.max(0, Math.min(image.naturalHeight - 1, Math.round(y! * scaleY)));
          const [red, green, blue] = context.getImageData(pixelX, pixelY, 1, 1).data;
          const background: Rgba = [red!, green!, blue!, 1];
          const effectiveForeground = composite(foreground, background);
          const [light, dark] = [luminance(effectiveForeground), luminance(background)].sort((a, b) => b - a);
          const ratio = (light! + 0.05) / (dark! + 0.05);
          return {
            label: target.label,
            ratio,
            required,
            foreground: target.color,
            background: `rgb(${red}, ${green}, ${blue})`
          };
        });
      });
    });
    const worst = [...samples].sort((left, right) => left.ratio / left.required - right.ratio / right.required)[0] ?? null;
    return {
      minimumRatio: samples.length > 0 ? Math.min(...samples.map((sample) => sample.ratio)) : 0,
      sampleCount: samples.length,
      violationCount: samples.filter((sample) => sample.ratio < sample.required).length,
      worst
    };
  }, { imageBase64: backgroundScreenshot.toString("base64"), targets });
}

for(const category of ARENA_CATEGORIES){
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
      const renderedContrast = await measureRenderedContrast(page);
      expect(renderedContrast.violationCount, JSON.stringify(renderedContrast.worst)).toBe(0);
      const visualQuality = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll<HTMLElement>("[data-page-node]")];
        const textElements = [...document.querySelectorAll<HTMLElement>("h1,h2,h3,p,a,button,li")]
          .filter((element) => element.textContent?.trim() && element.getClientRects().length > 0);
        const bodyStyle = getComputedStyle(document.body);
        const headingSizes = [...document.querySelectorAll<HTMLElement>("h1,h2,h3")].map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        const bodySize = Number.parseFloat(bodyStyle.fontSize);
        const nodeStyles = nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          const section = node.querySelector<HTMLElement>("[data-governed-section]") ?? node;
          const candidates = [section, ...section.querySelectorAll<HTMLElement>("*")];
          const background = candidates.map((candidate) => {
            const style = getComputedStyle(candidate);
            if (style.backgroundImage !== "none") return `${style.backgroundImage}|${style.backgroundColor}`;
            return style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent"
              ? style.backgroundColor
              : null;
          }).find((value): value is string => value !== null) ?? "root-surface";
          return { kind: node.dataset.pageNode ?? "unknown", background, top: rect.top, bottom: rect.bottom };
        });
        const verticalGaps = nodeStyles.slice(1).map((entry, index) => Math.max(0, entry.top - nodeStyles[index]!.bottom));
        const distinctBackgrounds = new Set(nodeStyles.map((entry) => entry.background)).size;
        const sectionTransitions = nodeStyles.slice(1).filter((entry, index) => entry.background !== nodeStyles[index]!.background).length;
        const clippedTextCount = textElements.filter((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const textRects = [...range.getClientRects()];
          let ancestor: HTMLElement | null = element;
          while (ancestor) {
            const style = getComputedStyle(ancestor);
            const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
            const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
            if (clipsX || clipsY) {
              const boundary = ancestor.getBoundingClientRect();
              if (textRects.some((rect) =>
                (clipsX && (rect.left < boundary.left - 1 || rect.right > boundary.right + 1)) ||
                (clipsY && (rect.top < boundary.top - 1 || rect.bottom > boundary.bottom + 1))
              )) return true;
            }
            ancestor = ancestor.parentElement;
          }
          return false;
        }).length;
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
          rhythm: {
            averageVerticalGap: verticalGaps.length > 0 ? verticalGaps.reduce((sum, value) => sum + value, 0) / verticalGaps.length : 0,
            distinctBackgrounds,
            sectionTransitions
          },
          ctaCount: document.querySelectorAll("a[href],button:not([disabled])").length,
          clippedTextCount
        };
      });
      const observationDirectory=join(process.cwd(),"artifacts","generated-pages","observations");
      await mkdir(observationDirectory,{recursive:true});
      await writeFile(join(observationDirectory,`${testInfo.project.name}--${category}.json`),`${JSON.stringify({...visualQuality,contrast:{minimumRatio:renderedContrast.minimumRatio,sampleCount:renderedContrast.sampleCount},category,project:testInfo.project.name},null,2)}\n`,`utf8`);
    }
  });
}
