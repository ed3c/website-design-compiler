import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { validateAgainstSchema } from "../src/validate.js";

const IMAGE_DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGOsCDjBQApgIkn1qIYRpAEAsVkBqEXr8uYAAAAASUVORK5CYII=";
const VIDEO_DATA = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAItEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggIX7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAl3AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIFes2+c7Qgi2cgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QdzWUA4JCwgRC6gRCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAzc3PWY8CLY8WIFes2+c7Qgi1nyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjUwMDAwMDAwMAAfQ7Z17+eBAKO8gQAAgLACAJ0BKhAAEAAARwiFhYiFhIgCAgJ1qgP4Agz9KAD+/00S//xYV/FhX8WFf/FhX/z8zu3F/OYAo5WBAfQAsQEAARAQABgAGFgv9AAIAACjlYED6ACxAQABEBAAGAAYWC/0AAgAABxTu2uRu4+zgQC3iveBAfGCAaPwgQM=";

function dataBytes(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("invalid data URL");
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

  await page.setContent(`<img id="reference-image" src="${IMAGE_DATA}" alt="deterministic fixture">`);
  await page.waitForFunction(() => {
    const image = document.getElementById("reference-image") as HTMLImageElement | null;
    return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  });
  const image = await page.evaluate(() => {
    const element = document.getElementById("reference-image") as HTMLImageElement;
    return {
      width: element.naturalWidth,
      height: element.naturalHeight,
      aspectRatio: Number((element.naturalWidth / element.naturalHeight).toFixed(6))
    };
  });

  await page.setContent(`<video id="reference-video" src="${VIDEO_DATA}" preload="auto" muted></video>`);
  await page.waitForFunction(() => {
    const video = document.getElementById("reference-video") as HTMLVideoElement | null;
    return Boolean(video && video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0 && Number.isFinite(video.duration));
  }, undefined, { timeout: 10_000 });
  const videoMetadata = await page.evaluate(() => {
    const video = document.getElementById("reference-video") as HTMLVideoElement;
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      durationSeconds: Number(video.duration.toFixed(6)),
      aspectRatio: Number((video.videoWidth / video.videoHeight).toFixed(6))
    };
  });
  const sampleTime = Math.max(0, Math.min(videoMetadata.durationSeconds / 2, Math.max(0, videoMetadata.durationSeconds - 0.01)));
  await page.evaluate(async (time) => {
    const video = document.getElementById("reference-video") as HTMLVideoElement;
    if (Math.abs(video.currentTime - time) < 0.001) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("video seek timeout")), 5000);
      video.addEventListener("seeked", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      video.currentTime = time;
    });
  }, sampleTime);
  const frameDataUrl = await page.evaluate(() => {
    const video = document.getElementById("reference-video") as HTMLVideoElement;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context unavailable");
    context.drawImage(video, 0, 0);
    return canvas.toDataURL("image/png");
  });
  const frameBytes = dataBytes(frameDataUrl);

  const receipt = {
    schema: "website-design-compiler/reference-media-receipt/v1",
    overall: "PASS" as const,
    browser: { engine: "chromium", version: browser.version() },
    image: {
      state: "PASS" as const,
      mimeType: "image/png",
      sourceSha256: sha256(dataBytes(IMAGE_DATA)),
      decodedWidth: image.width,
      decodedHeight: image.height,
      aspectRatio: image.aspectRatio,
      observableFacts: [`decoded image dimensions: ${image.width}x${image.height}`, `decoded image aspect ratio: ${image.aspectRatio}`],
      unknownSemanticContent: true as const
    },
    video: {
      state: "PASS" as const,
      mimeType: "video/webm",
      sourceSha256: sha256(dataBytes(VIDEO_DATA)),
      decodedWidth: videoMetadata.width,
      decodedHeight: videoMetadata.height,
      durationSeconds: videoMetadata.durationSeconds,
      aspectRatio: videoMetadata.aspectRatio,
      samples: [{ timeSeconds: Number(sampleTime.toFixed(6)), frameSha256: sha256(frameBytes), frameMimeType: "image/png" }],
      observableFacts: [
        `decoded video dimensions: ${videoMetadata.width}x${videoMetadata.height}`,
        `decoded video duration seconds: ${videoMetadata.durationSeconds}`,
        `decoded video aspect ratio: ${videoMetadata.aspectRatio}`,
        "sampled decoded frame count: 1"
      ],
      unknownSemanticContent: true as const,
      unknownCameraAndImplementationDetails: true as const
    }
  };

  await validateAgainstSchema(receipt, "reference-media-receipt.schema.json");
  const outputDirectory = join(process.cwd(), "artifacts", "reference-media");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "reference-media-receipt.json");
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, overall: receipt.overall, image: image, video: videoMetadata }));
} finally {
  await browser.close();
}
