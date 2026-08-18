import assert from "node:assert/strict";
import test from "node:test";
import {
  MediaAssetContentError,
  validateProductionMediaAssetContent
} from "../src/media-asset-validation.js";

const webp = new Uint8Array(Buffer.from(
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=",
  "base64"
));
const png = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGOsCDjBQApgIkn1qIYRpAEAsVkBqEXr8uYAAAAASUVORK5CYII=",
  "base64"
));

function image(mediaType: string, extension: string, bytes: Uint8Array, width?: number, height?: number) {
  return validateProductionMediaAssetContent(
    "image",
    { mediaType, extension, bytes },
    { ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) }
  );
}

test("raster admission validates exact magic, full PNG scanline decode, dimensions, and request binding", () => {
  assert.deepEqual(image("image/png", "png", png, 16, 12), {
    format: "png",
    width: 16,
    height: 12,
    validation: "CONTENT_VALIDATION_PASS"
  });
  const gif = new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
  assert.throws(() => image("image/webp", "webp", webp, 1, 1), /no admitted full pixel decoder/);
  assert.throws(() => image("image/gif", "gif", gif, 1, 1), /no admitted full pixel decoder/);
});

test("text-as-WebP, truncated containers, corrupt CRCs, and dimension drift fail closed", () => {
  assert.throws(
    () => image("image/webp", "webp", new TextEncoder().encode("production-fixture"), 1, 1),
    (error: unknown) => error instanceof MediaAssetContentError && /WebP.*signature/.test(error.message)
  );
  assert.throws(() => image("image/webp", "webp", webp.subarray(0, 20), 1, 1), /length|truncated/);
  const corruptPng = png.slice();
  corruptPng[50] = (corruptPng[50] ?? 0) ^ 0xff;
  assert.throws(() => image("image/png", "png", corruptPng, 16, 12), /CRC|decompress/);
  assert.throws(() => image("image/png", "png", png, 15, 12), /width.*requested/);
});

test("static self-contained SVG passes while active or external SVG fails closed", () => {
  const safe = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" viewBox="0 0 10 20"><rect width="10" height="20" fill="#fff"/></svg>'
  );
  assert.deepEqual(image("image/svg+xml", "svg", safe, 10, 20), {
    format: "svg",
    width: 10,
    height: 20,
    validation: "CONTENT_VALIDATION_PASS"
  });
  for (const source of [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><use href="https://assets.invalid/icon.svg#x"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><style>rect{fill:url(https://assets.invalid/x)}</style></svg>'
  ]) {
    assert.throws(() => image("image/svg+xml", "svg", new TextEncoder().encode(source), 1, 1), /active content|external references/);
  }
});

function glb(document: object, binary = new Uint8Array()): Uint8Array {
  const jsonSource = JSON.stringify(document);
  const jsonPadding = (4 - (Buffer.byteLength(jsonSource) % 4)) % 4;
  const json = Buffer.from(`${jsonSource}${" ".repeat(jsonPadding)}`);
  const binaryPadding = (4 - (binary.length % 4)) % 4;
  const paddedBinary = Buffer.concat([Buffer.from(binary), Buffer.alloc(binaryPadding)]);
  const total = 12 + 8 + json.length + (paddedBinary.length > 0 ? 8 + paddedBinary.length : 0);
  const output = Buffer.alloc(total);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(total, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  if (paddedBinary.length > 0) {
    const offset = 20 + json.length;
    output.writeUInt32LE(paddedBinary.length, offset);
    output.writeUInt32LE(0x004e4942, offset + 4);
    paddedBinary.copy(output, offset + 8);
  }
  return new Uint8Array(output);
}

test("glTF and GLB admit only version-2 self-contained resources", () => {
  const minimal = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{}], nodes: [] }));
  assert.equal(validateProductionMediaAssetContent(
    "3d",
    { mediaType: "model/gltf+json", extension: "gltf", bytes: minimal },
    {}
  ).format, "gltf");

  const embeddedGlb = glb({ asset: { version: "2.0" }, buffers: [{ byteLength: 4 }] }, Uint8Array.of(1, 2, 3, 4));
  assert.equal(validateProductionMediaAssetContent(
    "3d",
    { mediaType: "model/gltf-binary", extension: "glb", bytes: embeddedGlb },
    {}
  ).format, "glb");

  const external = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 4, uri: "payload.bin" }]
  }));
  assert.throws(
    () => validateProductionMediaAssetContent("3d", { mediaType: "model/gltf+json", extension: "gltf", bytes: external }, {}),
    /external or data URI/
  );
  assert.throws(
    () => validateProductionMediaAssetContent("3d", { mediaType: "model/vnd.usdz+zip", extension: "usdz", bytes: Uint8Array.of(0x50, 0x4b, 3, 4) }, {}),
    /no admitted embedded-resource validator/
  );
});
