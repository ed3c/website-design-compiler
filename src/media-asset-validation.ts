import { inflateSync } from "node:zlib";
import type { MediaAsset, MediaKind } from "./media-router.js";

export interface ValidatedMediaAssetContent {
  format: string;
  width: number | null;
  height: number | null;
  validation: "CONTENT_VALIDATION_PASS";
}

export class MediaAssetContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaAssetContentError";
  }
}

function fail(message: string): never {
  throw new MediaAssetContentError(message);
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function positiveDimensions(format: string, width: number, height: number): ValidatedMediaAssetContent {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16_384 || height > 16_384) {
    fail(`${format} has invalid or unsafe decoded dimensions`);
  }
  return { format, width, height, validation: "CONTENT_VALIDATION_PASS" };
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = (crcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function validatePng(bytes: Uint8Array): ValidatedMediaAssetContent {
  if (!bytesEqual(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) fail("PNG signature is invalid");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitsPerPixel = 0;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  const compressed: Uint8Array[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail("PNG chunk header is truncated");
    const length = uint32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > bytes.length) fail("PNG chunk is malformed or truncated");
    const expectedCrc = uint32be(bytes, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) fail(`PNG ${type} chunk CRC is invalid`);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (!sawHeader && type !== "IHDR") fail("PNG IHDR must be the first chunk");
    if (type === "IHDR") {
      if (sawHeader || length !== 13) fail("PNG IHDR is invalid or duplicated");
      sawHeader = true;
      width = uint32be(data, 0);
      height = uint32be(data, 4);
      const bitDepth = data[8] ?? 0;
      const colorType = data[9] ?? 0;
      const validDepths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]
      };
      if (!validDepths[colorType]?.includes(bitDepth)) fail("PNG bit depth and color type are incompatible");
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) fail("PNG uses an unsupported compression, filter, or interlace method");
      const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
      bitsPerPixel = (channels[colorType] ?? 0) * bitDepth;
      positiveDimensions("png", width, height);
    } else if (type === "IDAT") {
      if (!sawHeader || sawEnd) fail("PNG IDAT ordering is invalid");
      sawData = true;
      compressed.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || sawEnd) fail("PNG IEND is invalid or duplicated");
      sawEnd = true;
      if (end !== bytes.length) fail("PNG contains bytes after IEND");
    }
    offset = end;
  }
  if (!sawHeader || !sawData || !sawEnd) fail("PNG is missing IHDR, IDAT, or IEND");
  let decoded: Uint8Array;
  const scanlineBytes = Math.ceil(width * bitsPerPixel / 8);
  const expectedDecodedBytes = height * (scanlineBytes + 1);
  if (!Number.isSafeInteger(expectedDecodedBytes) || expectedDecodedBytes > 134_217_728) {
    fail("PNG decoded pixel buffer exceeds the admitted memory budget");
  }
  try {
    decoded = inflateSync(
      Buffer.concat(compressed.map((entry) => Buffer.from(entry))),
      { maxOutputLength: expectedDecodedBytes + 1 }
    );
  } catch {
    fail("PNG image data cannot be decompressed");
  }
  if (decoded.length !== expectedDecodedBytes) fail("PNG decoded scanline length does not match its dimensions");
  for (let row = 0; row < height; row += 1) {
    const filter = decoded[row * (scanlineBytes + 1)];
    if (filter === undefined || filter > 4) fail("PNG scanline uses an invalid filter");
  }
  return positiveDimensions("png", width, height);
}

function validateWebp(bytes: Uint8Array): ValidatedMediaAssetContent {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") fail("WebP RIFF signature is invalid");
  if (uint32le(bytes, 4) + 8 !== bytes.length) fail("WebP RIFF length does not match the asset bytes");
  let offset = 12;
  let dimensions: { width: number; height: number } | undefined;
  let sawImagePayload = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail("WebP chunk header is truncated");
    const type = ascii(bytes, offset, 4);
    const length = uint32le(bytes, offset + 4);
    const dataOffset = offset + 8;
    const end = dataOffset + length;
    if (end > bytes.length) fail("WebP chunk is truncated");
    if (type === "VP8 ") {
      if (length < 10 || !bytesEqual(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])) fail("WebP VP8 frame header is invalid");
      dimensions = {
        width: uint16be(Uint8Array.of(bytes[dataOffset + 7] ?? 0, bytes[dataOffset + 6] ?? 0), 0) & 0x3fff,
        height: uint16be(Uint8Array.of(bytes[dataOffset + 9] ?? 0, bytes[dataOffset + 8] ?? 0), 0) & 0x3fff
      };
      sawImagePayload = true;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[dataOffset] !== 0x2f) fail("WebP VP8L frame header is invalid");
      const packed = uint32le(bytes, dataOffset + 1);
      dimensions = { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
      sawImagePayload = true;
    } else if (type === "VP8X") {
      if (length !== 10) fail("WebP VP8X header is invalid");
      if (((bytes[dataOffset] ?? 0) & 0x02) !== 0) fail("animated WebP is not admitted as a still image asset");
      dimensions = { width: uint24le(bytes, dataOffset + 4) + 1, height: uint24le(bytes, dataOffset + 7) + 1 };
    }
    offset = end + (length % 2);
    if (offset > bytes.length) fail("WebP chunk padding is truncated");
  }
  if (offset !== bytes.length || !dimensions || !sawImagePayload) fail("WebP does not contain a complete image payload");
  return positiveDimensions("webp", dimensions.width, dimensions.height);
}

function consumeGifSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset] ?? 0;
    offset += 1;
    if (size === 0) return offset;
    if (offset + size > bytes.length) fail("GIF data sub-block is truncated");
    offset += size;
  }
  fail("GIF data sub-block terminator is absent");
}

function validateGif(bytes: Uint8Array): ValidatedMediaAssetContent {
  const signature = ascii(bytes, 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") fail("GIF signature is invalid");
  if (bytes.length < 14) fail("GIF header is truncated");
  const width = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
  const height = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  const packed = bytes[10] ?? 0;
  let offset = 13 + ((packed & 0x80) !== 0 ? 3 * (2 ** ((packed & 0x07) + 1)) : 0);
  let imageCount = 0;
  let trailer = false;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      trailer = true;
      if (offset !== bytes.length) fail("GIF contains bytes after its trailer");
      break;
    }
    if (marker === 0x21) {
      if (offset >= bytes.length) fail("GIF extension label is truncated");
      offset += 1;
      offset = consumeGifSubBlocks(bytes, offset);
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) fail("GIF block marker or image descriptor is invalid");
    const descriptorPacked = bytes[offset + 8] ?? 0;
    offset += 9;
    if ((descriptorPacked & 0x80) !== 0) offset += 3 * (2 ** ((descriptorPacked & 0x07) + 1));
    if (offset >= bytes.length || (bytes[offset] ?? 0) < 2 || (bytes[offset] ?? 0) > 12) fail("GIF LZW code size is invalid");
    offset += 1;
    offset = consumeGifSubBlocks(bytes, offset);
    imageCount += 1;
  }
  if (!trailer || imageCount < 1) fail("GIF has no complete image frame or trailer");
  return positiveDimensions("gif", width, height);
}

function validateJpeg(bytes: Uint8Array): ValidatedMediaAssetContent {
  if (!bytesEqual(bytes, 0, [0xff, 0xd8])) fail("JPEG SOI signature is invalid");
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;
  let sawEnd = false;
  const standalone = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) fail("JPEG marker prefix is invalid");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0x00) fail("JPEG marker is truncated or invalid");
    if (marker === 0xd9) {
      sawEnd = true;
      if (offset !== bytes.length) fail("JPEG contains bytes after EOI");
      break;
    }
    if (standalone.has(marker)) continue;
    if (offset + 2 > bytes.length) fail("JPEG segment length is truncated");
    const length = uint16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) fail("JPEG segment length is invalid");
    if (startOfFrame.has(marker)) {
      if (length < 8) fail("JPEG frame header is truncated");
      height = uint16be(bytes, offset + 3);
      width = uint16be(bytes, offset + 5);
    }
    if (marker === 0xda) {
      sawScan = true;
      offset += length;
      while (offset < bytes.length - 1) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        break;
      }
      continue;
    }
    offset += length;
  }
  if (!sawScan || !sawEnd || width < 1 || height < 1) fail("JPEG is missing a decodable frame, scan, or EOI marker");
  return positiveDimensions("jpeg", width, height);
}

function parseSvgNumber(value: string | undefined): number | undefined {
  if (!value || !/^(?:\d+|\d*\.\d+)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function validateSvg(bytes: Uint8Array): ValidatedMediaAssetContent {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("SVG is not valid UTF-8");
  }
  const trimmed = source.trim();
  if (!/^<svg\b/i.test(trimmed) || !/<\/svg>$/i.test(trimmed)) fail("SVG root element is invalid or incomplete");
  const forbidden = [
    /<!doctype|<!entity|<\?xml/i,
    /<(?:script|style|foreignObject|iframe|object|embed|audio|video|image|animate|animateMotion|animateTransform|set)\b/i,
    /\son[a-z]+\s*=/i,
    /(?:javascript|vbscript|data|file):/i,
    /\b(?:href|xlink:href|src)\s*=\s*["'](?!#)[^"']+["']/i,
    /url\(\s*["']?(?!#)/i
  ];
  if (forbidden.some((pattern) => pattern.test(trimmed))) fail("SVG contains active content, external references, or unsupported resources");
  const openTag = /^<svg\b[^>]*>/i.exec(trimmed)?.[0];
  if (!openTag || !/\bxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(openTag)) fail("SVG namespace is absent or invalid");
  const width = parseSvgNumber(/\bwidth\s*=\s*["']([^"']+)["']/i.exec(openTag)?.[1]);
  const height = parseSvgNumber(/\bheight\s*=\s*["']([^"']+)["']/i.exec(openTag)?.[1]);
  const viewBox = /\bviewBox\s*=\s*["']\s*[-+]?\d*\.?\d+(?:\s+[-+]?\d*\.?\d+){3}\s*["']/i.exec(openTag)?.[0];
  if ((!width || !height) && !viewBox) fail("SVG must declare positive numeric width/height or a finite viewBox");
  return width && height
    ? positiveDimensions("svg", width, height)
    : { format: "svg", width: null, height: null, validation: "CONTENT_VALIDATION_PASS" };
}

function validateAvif(bytes: Uint8Array): ValidatedMediaAssetContent {
  let offset = 0;
  let compatible = false;
  let dimensions: { width: number; height: number } | undefined;
  const walkBoxes = (start: number, end: number, depth: number) => {
    if (depth > 8) fail("AVIF box nesting is unsafe");
    let cursor = start;
    while (cursor < end) {
      if (cursor + 8 > end) fail("AVIF box header is truncated");
      let size = uint32be(bytes, cursor);
      const type = ascii(bytes, cursor + 4, 4);
      let header = 8;
      if (size === 1) fail("AVIF 64-bit box sizes are not admitted");
      if (size === 0) size = end - cursor;
      if (size < header || cursor + size > end) fail("AVIF box size is invalid");
      const dataStart = cursor + header;
      if (type === "ftyp") {
        if (size < 16) fail("AVIF ftyp box is truncated");
        const brands: string[] = [ascii(bytes, dataStart, 4)];
        for (let brandOffset = dataStart + 8; brandOffset + 4 <= cursor + size; brandOffset += 4) brands.push(ascii(bytes, brandOffset, 4));
        compatible = brands.some((brand) => brand === "avif" || brand === "avis");
      } else if (type === "ispe") {
        if (size < 20) fail("AVIF ispe box is truncated");
        dimensions = { width: uint32be(bytes, dataStart + 4), height: uint32be(bytes, dataStart + 8) };
      } else if (["meta", "iprp", "ipco"].includes(type)) {
        walkBoxes(dataStart + (type === "meta" ? 4 : 0), cursor + size, depth + 1);
      }
      cursor += size;
    }
  };
  walkBoxes(0, bytes.length, 0);
  if (!compatible || !dimensions) fail("AVIF compatible brand or decoded dimensions are absent");
  return positiveDimensions("avif", dimensions.width, dimensions.height);
}

function validateStillImage(mediaType: string, bytes: Uint8Array): ValidatedMediaAssetContent {
  switch (mediaType.toLowerCase()) {
    case "image/png": return validatePng(bytes);
    case "image/svg+xml": return validateSvg(bytes);
    case "image/webp":
      validateWebp(bytes);
      fail("WebP has no admitted full pixel decoder");
    case "image/gif":
      validateGif(bytes);
      fail("GIF has no admitted full pixel decoder");
    case "image/jpeg":
      validateJpeg(bytes);
      fail("JPEG has no admitted full pixel decoder");
    case "image/avif":
      validateAvif(bytes);
      fail("AVIF has no admitted full pixel decoder");
    default: fail("image format has no admitted production content validator");
  }
}

function assertNoExternalGltfResources(value: unknown, path = "$", glbBinary?: Uint8Array): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoExternalGltfResources(entry, `${path}[${index}]`, glbBinary));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "uri") fail(`glTF external or data URI is not admitted at ${path}.${key}`);
    assertNoExternalGltfResources(entry, `${path}.${key}`, glbBinary);
  }
}

function validateGltfDocument(document: unknown, glbBinary?: Uint8Array): void {
  if (document === null || typeof document !== "object" || Array.isArray(document)) fail("glTF JSON root must be an object");
  const root = document as Record<string, unknown>;
  const asset = root.asset;
  if (asset === null || typeof asset !== "object" || Array.isArray(asset) || (asset as Record<string, unknown>).version !== "2.0") {
    fail("glTF asset.version must be exactly 2.0");
  }
  for (const extensionKey of ["extensionsUsed", "extensionsRequired"] as const) {
    const extensions = root[extensionKey];
    if (extensions !== undefined && (!Array.isArray(extensions) || extensions.length > 0)) {
      fail(`glTF ${extensionKey} must be empty because no extension resource validator is configured`);
    }
  }
  assertNoExternalGltfResources(root, "$", glbBinary);
  const buffers = root.buffers;
  if (buffers !== undefined) {
    if (!Array.isArray(buffers)) fail("glTF buffers must be an array");
    for (const [index, buffer] of buffers.entries()) {
      if (buffer === null || typeof buffer !== "object" || Array.isArray(buffer)) fail(`glTF buffer ${index} is invalid`);
      const byteLength = (buffer as Record<string, unknown>).byteLength;
      if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 0) fail(`glTF buffer ${index} byteLength is invalid`);
      if (!glbBinary || (byteLength as number) > glbBinary.length) fail(`glTF buffer ${index} is not satisfied by an embedded GLB BIN chunk`);
    }
  }
}

function validateGltf(bytes: Uint8Array): ValidatedMediaAssetContent {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("glTF JSON is not valid UTF-8");
  }
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch {
    fail("glTF JSON cannot be parsed");
  }
  validateGltfDocument(document);
  return { format: "gltf", width: null, height: null, validation: "CONTENT_VALIDATION_PASS" };
}

function validateGlb(bytes: Uint8Array): ValidatedMediaAssetContent {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "glTF") fail("GLB magic is invalid");
  if (uint32le(bytes, 4) !== 2 || uint32le(bytes, 8) !== bytes.length) fail("GLB version or declared length is invalid");
  let offset = 12;
  let json: Uint8Array | undefined;
  let binary: Uint8Array | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail("GLB chunk header is truncated");
    const length = uint32le(bytes, offset);
    const type = uint32le(bytes, offset + 4);
    const end = offset + 8 + length;
    if (length % 4 !== 0 || end > bytes.length) fail("GLB chunk length is invalid");
    if (type === 0x4e4f534a) {
      if (json || binary) fail("GLB JSON chunk must be first and unique");
      json = bytes.subarray(offset + 8, end);
    } else if (type === 0x004e4942) {
      if (!json || binary) fail("GLB BIN chunk ordering or uniqueness is invalid");
      binary = bytes.subarray(offset + 8, end);
    } else {
      fail("GLB contains an unknown chunk type");
    }
    offset = end;
  }
  if (!json) fail("GLB JSON chunk is absent");
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json).trimEnd());
  } catch {
    fail("GLB JSON chunk cannot be decoded");
  }
  validateGltfDocument(document, binary);
  return { format: "glb", width: null, height: null, validation: "CONTENT_VALIDATION_PASS" };
}

function validateVideo(mediaType: string, bytes: Uint8Array): ValidatedMediaAssetContent {
  const type = mediaType.toLowerCase();
  if (type === "video/mp4" || type === "video/quicktime") {
    if (bytes.length < 24 || ascii(bytes, 4, 4) !== "ftyp") fail("ISO BMFF video ftyp signature is invalid");
    let offset = 0;
    const boxes = new Set<string>();
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) fail("ISO BMFF video box header is truncated");
      const size = uint32be(bytes, offset);
      const boxType = ascii(bytes, offset + 4, 4);
      if (size < 8 || offset + size > bytes.length) fail("ISO BMFF video box size is invalid");
      boxes.add(boxType);
      offset += size;
    }
    if (!boxes.has("ftyp") || !boxes.has("moov") || !boxes.has("mdat")) fail("ISO BMFF video is missing ftyp, moov, or mdat");
    fail("ISO BMFF video has no admitted full media decoder");
  }
  if (type === "video/webm") {
    if (!bytesEqual(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3]) || !bytes.some((byte, index) => byte === 0x18 && bytesEqual(bytes, index, [0x18, 0x53, 0x80, 0x67]))) {
      fail("WebM EBML header or Segment element is absent");
    }
    fail("WebM has no admitted full media decoder");
  }
  if (type === "video/ogg") {
    if (ascii(bytes, 0, 4) !== "OggS") fail("Ogg video capture pattern is invalid");
    fail("Ogg video has no admitted full media decoder");
  }
  fail("video format has no admitted production content validator");
}

export function validateProductionMediaAssetContent(
  kind: MediaKind,
  asset: MediaAsset,
  requestParameters: Record<string, string | number | boolean>
): ValidatedMediaAssetContent {
  const result = kind === "image"
    ? validateStillImage(asset.mediaType, asset.bytes)
    : kind === "video"
      ? validateVideo(asset.mediaType, asset.bytes)
      : asset.mediaType.toLowerCase() === "model/gltf+json"
        ? validateGltf(asset.bytes)
        : asset.mediaType.toLowerCase() === "model/gltf-binary"
          ? validateGlb(asset.bytes)
          : fail("3D format has no admitted embedded-resource validator");
  if (kind === "image" && result.width !== null && result.height !== null) {
    const expectedWidth = requestParameters.width;
    const expectedHeight = requestParameters.height;
    if (typeof expectedWidth === "number" && (!Number.isSafeInteger(expectedWidth) || expectedWidth !== result.width)) {
      fail("decoded image width does not match the requested width");
    }
    if (typeof expectedHeight === "number" && (!Number.isSafeInteger(expectedHeight) || expectedHeight !== result.height)) {
      fail("decoded image height does not match the requested height");
    }
  }
  return result;
}
