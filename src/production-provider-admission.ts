import { createPublicKey, verify } from "node:crypto";
import { canonicalMediaValue, sha256 } from "./media-router.js";

export interface ProductionAdmissionPacket {
  schema: "website-design-compiler/production-provider-admission/v1";
  state: "ADMITTED";
  admissionId: string;
  approvedBy: string;
  issuedAt: string;
  expiresAt: string;
  requestSha256: string;
  providerIdentitySha256: string;
  modelIdentitySha256: string;
  policySha256: string;
  rightsReceiptSha256: string;
  credentials: "AVAILABLE";
  budget: "AUTHORIZED";
  rateLimitRemaining: number;
  quotaUnitsRemaining: number;
  authorityKeySha256: string;
  signatureAlgorithm: "Ed25519";
  signatureBase64: string;
}

export interface ProductionAdmissionAuthority {
  authorityId: string;
  publicKeyPem: string;
}

export interface ExpectedProductionAdmissionBindings {
  requestSha256: string;
  providerIdentitySha256: string;
  modelIdentitySha256: string;
  policySha256: string;
  rightsReceiptSha256: string;
}

const packetKeys = [
  "schema",
  "state",
  "admissionId",
  "approvedBy",
  "issuedAt",
  "expiresAt",
  "requestSha256",
  "providerIdentitySha256",
  "modelIdentitySha256",
  "policySha256",
  "rightsReceiptSha256",
  "credentials",
  "budget",
  "rateLimitRemaining",
  "quotaUnitsRemaining",
  "authorityKeySha256",
  "signatureAlgorithm",
  "signatureBase64"
] as const;

const safeOpaqueId = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const sha256Hex = /^[a-f0-9]{64}$/;
const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function strictlyHasPacketKeys(packet: Record<string, unknown>): boolean {
  const actual = Object.keys(packet).sort();
  const expected = [...packetKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function productionAdmissionSigningPayload(packet: ProductionAdmissionPacket): string {
  const { signatureBase64: _signature, ...unsigned } = packet;
  return canonicalMediaValue(unsigned);
}

export function productionAdmissionPacketSha256(packet: ProductionAdmissionPacket): string {
  return sha256(canonicalMediaValue(packet));
}

function authorityKeySha256(publicKeyPem: string): string {
  const publicKey = createPublicKey(publicKeyPem);
  return sha256(publicKey.export({ type: "spki", format: "der" }));
}

export function validateProductionAdmissionPacket(args: {
  packet: unknown;
  expected: ExpectedProductionAdmissionBindings;
  authorities: readonly ProductionAdmissionAuthority[];
  now: Date;
}): string[] {
  const errors: string[] = [];
  if (!isRecord(args.packet)) return ["admission packet must be an object"];
  const packet = args.packet;
  if (!strictlyHasPacketKeys(packet)) errors.push("admission packet fields do not match the strict schema");
  if (packet.schema !== "website-design-compiler/production-provider-admission/v1") errors.push("admission schema is invalid");
  if (packet.state !== "ADMITTED") errors.push("admission state is not ADMITTED");
  if (typeof packet.admissionId !== "string" || !safeOpaqueId.test(packet.admissionId)) errors.push("admissionId must be a safe opaque identity");
  if (typeof packet.approvedBy !== "string" || !safeOpaqueId.test(packet.approvedBy)) errors.push("approvedBy must be a safe opaque identity");
  if (!isIsoTimestamp(packet.issuedAt)) errors.push("issuedAt must be an exact ISO timestamp");
  if (!isIsoTimestamp(packet.expiresAt)) errors.push("expiresAt must be an exact ISO timestamp");
  if (isIsoTimestamp(packet.issuedAt) && isIsoTimestamp(packet.expiresAt)) {
    const issuedAt = Date.parse(packet.issuedAt);
    const expiresAt = Date.parse(packet.expiresAt);
    if (expiresAt <= issuedAt) errors.push("admission expiresAt must be after issuedAt");
    if (args.now.getTime() < issuedAt) errors.push("admission is not yet valid");
    if (args.now.getTime() >= expiresAt) errors.push("admission has expired");
  }
  for (const key of [
    "requestSha256",
    "providerIdentitySha256",
    "modelIdentitySha256",
    "policySha256",
    "rightsReceiptSha256",
    "authorityKeySha256"
  ] as const) {
    if (typeof packet[key] !== "string" || !sha256Hex.test(packet[key])) errors.push(`${key} must be an exact SHA-256 digest`);
  }
  for (const [key, expected] of Object.entries(args.expected)) {
    if (packet[key] !== expected) errors.push(`${key} does not match the exact admitted execution input`);
  }
  if (packet.credentials !== "AVAILABLE") errors.push("runtime credentials are not admitted");
  if (packet.budget !== "AUTHORIZED") errors.push("runtime budget is not authorized");
  for (const key of ["rateLimitRemaining", "quotaUnitsRemaining"] as const) {
    if (!Number.isSafeInteger(packet[key]) || (packet[key] as number) < 0) errors.push(`${key} must be a non-negative safe integer`);
  }
  if (packet.signatureAlgorithm !== "Ed25519") errors.push("admission signature algorithm must be Ed25519");
  if (typeof packet.signatureBase64 !== "string" || !canonicalBase64.test(packet.signatureBase64) || packet.signatureBase64.length === 0) {
    errors.push("admission signature must be canonical base64");
  }

  const authority = typeof packet.approvedBy === "string"
    ? args.authorities.find((candidate) => candidate.authorityId === packet.approvedBy)
    : undefined;
  if (!authority) {
    errors.push("admission authority is not trusted by this execution");
    return errors;
  }
  if (!safeOpaqueId.test(authority.authorityId)) errors.push("trusted admission authorityId is invalid");
  try {
    const keySha256 = authorityKeySha256(authority.publicKeyPem);
    if (packet.authorityKeySha256 !== keySha256) errors.push("admission authority key digest does not match the trusted key");
    if (errors.length === 0) {
      const valid = verify(
        null,
        Buffer.from(productionAdmissionSigningPayload(packet as unknown as ProductionAdmissionPacket)),
        createPublicKey(authority.publicKeyPem),
        Buffer.from(packet.signatureBase64 as string, "base64")
      );
      if (!valid) errors.push("admission signature verification failed");
    }
  } catch {
    errors.push("trusted admission public key or signature is invalid");
  }
  return errors;
}
