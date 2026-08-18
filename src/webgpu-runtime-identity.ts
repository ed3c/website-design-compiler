export interface WebGPUAdapterInfoEvidence {
  state: "REPORTED" | "UNREPORTED";
  sha256: string;
}

export interface WebGPUAdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

function normalized(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "UNREPORTED";
}

export function canonicalWebGPUAdapterInfo(info: WebGPUAdapterInfoLike): string {
  return JSON.stringify({
    architecture: normalized(info.architecture),
    description: normalized(info.description),
    device: normalized(info.device),
    vendor: normalized(info.vendor)
  });
}

export async function buildWebGPUAdapterInfoEvidence(info: WebGPUAdapterInfoLike): Promise<WebGPUAdapterInfoEvidence> {
  const canonical = canonicalWebGPUAdapterInfo(info);
  const bytes = new TextEncoder().encode(`website-design-compiler/webgpu-adapter-info/v1\n${canonical}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    state: Object.values(JSON.parse(canonical) as Record<string, string>).some((value) => value !== "UNREPORTED")
      ? "REPORTED"
      : "UNREPORTED",
    sha256
  };
}
