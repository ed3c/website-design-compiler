import { inflateSync } from "node:zlib";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function assertPngEvidence(bytes: Uint8Array, expected: { width: number; maximumWidth?: number; minimumHeight: number; viewport: string }): void {
  const value = Buffer.from(bytes);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (value.length < 24 || !value.subarray(0, 8).equals(signature) || value.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`visual evidence for ${expected.viewport} is not a PNG browser screenshot`);
  }
  const width = value.readUInt32BE(16);
  const height = value.readUInt32BE(20);
  const widthMatches = expected.maximumWidth === undefined
    ? width === expected.width
    : width >= expected.width && width <= expected.maximumWidth;
  if (!widthMatches || height < expected.minimumHeight) {
    throw new Error(`visual evidence PNG dimensions do not match the ${expected.viewport} browser viewport`);
  }
  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  let bitDepth = 0;
  let colorType = -1;
  let sawPalette = false;
  const imageData: Buffer[] = [];
  while (offset + 12 <= value.length) {
    const length = value.readUInt32BE(offset);
    const type = value.toString("ascii", offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > value.length) throw new Error(`visual evidence for ${expected.viewport} has a truncated PNG chunk`);
    const dataEnd = offset + 8 + length;
    if (crc32(value.subarray(offset + 4, dataEnd)) !== value.readUInt32BE(dataEnd)) {
      throw new Error(`visual evidence for ${expected.viewport} has an invalid PNG chunk checksum`);
    }
    if (!sawHeader && type !== "IHDR") throw new Error(`visual evidence for ${expected.viewport} does not start with PNG IHDR`);
    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new Error(`visual evidence for ${expected.viewport} has an invalid PNG IHDR`);
      sawHeader = true;
      bitDepth = value[offset + 16]!;
      colorType = value[offset + 17]!;
      if (value[offset + 18] !== 0 || value[offset + 19] !== 0 || value[offset + 20] !== 0) {
        throw new Error(`visual evidence for ${expected.viewport} uses unsupported PNG encoding`);
      }
    }
    if (type === "IDAT" && length > 0) {
      sawImageData = true;
      imageData.push(value.subarray(offset + 8, dataEnd));
    }
    if (type === "PLTE") {
      if (sawImageData || length === 0 || length > 768 || length % 3 !== 0) {
        throw new Error(`visual evidence for ${expected.viewport} has an invalid PNG palette`);
      }
      sawPalette = true;
    }
    if (type === "IEND") {
      if (length !== 0) throw new Error(`visual evidence for ${expected.viewport} has an invalid PNG IEND`);
      sawEnd = true;
      offset = next;
      break;
    }
    offset = next;
  }
  if (!sawHeader || !sawImageData || !sawEnd || offset !== value.length) {
    throw new Error(`visual evidence for ${expected.viewport} is not a complete PNG browser screenshot`);
  }
  const channelsByColorType = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);
  const validBitDepths = new Map([[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]);
  const channels = channelsByColorType.get(colorType);
  if (!channels || !validBitDepths.get(colorType)?.includes(bitDepth) || height > 32768) {
    throw new Error(`visual evidence for ${expected.viewport} uses unsupported PNG pixel data`);
  }
  if (colorType === 3 && !sawPalette) throw new Error(`visual evidence for ${expected.viewport} is missing its PNG palette`);
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const expectedDecodedBytes = height * (rowBytes + 1);
  if (!Number.isSafeInteger(expectedDecodedBytes) || expectedDecodedBytes > 128 * 1024 * 1024) {
    throw new Error(`visual evidence for ${expected.viewport} exceeds the PNG decode budget`);
  }
  let decoded: Buffer;
  try {
    decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedDecodedBytes + 1 });
  } catch {
    throw new Error(`visual evidence for ${expected.viewport} has invalid compressed PNG pixel data`);
  }
  if (decoded.length !== expectedDecodedBytes) {
    throw new Error(`visual evidence for ${expected.viewport} has incomplete decoded PNG pixel data`);
  }
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (rowBytes + 1)]! > 4) throw new Error(`visual evidence for ${expected.viewport} has an invalid PNG row filter`);
  }
}
