import type { EvidenceState } from "./contracts.js";
import {
  captureRemoteUrl,
  type CapturedReference,
  type RemoteCaptureDependencies,
  type RemoteDnsResolution,
  type RemoteRedirectEvidence
} from "./reference-capture.js";

export interface LiveReferenceAdmit {
  schema: "website-design-compiler/live-reference-admit/v1";
  approvalId: string;
  approvedAt: string;
  targets: string[];
}

export interface LiveReferenceTargetReceipt {
  targetUrl?: string;
  finalUrl?: string;
  state: EvidenceState;
  availability: "AVAILABLE" | "UNAVAILABLE" | "NOT_ASSESSED";
  failureKind?: "AVAILABILITY" | "POLICY" | "COMPILER";
  failureReason?: string;
  httpStatus?: number;
  contentType?: string;
  responseBytes?: number;
  responseSha256?: string;
  artifactIdentity?: string;
  capturedAt?: string;
  dnsResolutions: RemoteDnsResolution[];
  redirectChain: RemoteRedirectEvidence[];
  connectedAddress?: string;
  attemptCount: number;
  observations: string[];
  implementationDetails: "UNKNOWN";
  drift: "BASELINE" | "UNCHANGED" | "CHANGED" | "NOT_OBSERVED";
}

export interface LiveReferenceReceipt {
  schema: "website-design-compiler/live-reference-receipt/v2";
  overall: "PASS" | "FAIL" | "NOT_EXERCISED";
  executionMode: "LIVE";
  transportMode: "PRODUCTION" | "INJECTED";
  approval: { id: string; approvedAt: string; targetCount: number };
  policy: {
    minimumDistinctHttpsTargets: 2;
    timeoutMs: number;
    maxAttempts: number;
    retryBackoffMs: number;
    maxRedirects: number;
    maxBytes: number;
  };
  targets: LiveReferenceTargetReceipt[];
  promotionBlockedReason: string | null;
}

export interface LiveReferenceDependencies extends RemoteCaptureDependencies {
  capture?: (target: string, dependencies: RemoteCaptureDependencies) => Promise<CapturedReference>;
  previousHashes?: Record<string, string>;
}

const DEFAULT_POLICY = {
  timeoutMs: 10_000,
  maxAttempts: 3,
  retryBackoffMs: 250,
  maxRedirects: 3,
  maxBytes: 2 * 1024 * 1024
} as const;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(Math.trunc(value), maximum));
}

function normalizedAdmittedTargets(admit: LiveReferenceAdmit): string[] {
  if (admit.schema !== "website-design-compiler/live-reference-admit/v1") {
    throw new Error("live reference admit schema is invalid");
  }
  if (!/^[a-zA-Z0-9._:-]{3,80}$/.test(admit.approvalId)) {
    throw new Error("live reference approvalId is invalid");
  }
  if (!Number.isFinite(Date.parse(admit.approvedAt))) {
    throw new Error("live reference approvedAt is invalid");
  }

  const targets = admit.targets.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("every admitted live reference target must be an absolute public HTTPS URL");
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && url.port !== "443") ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      throw new Error("every admitted live reference target must satisfy the public HTTPS URL policy");
    }
    return url.toString();
  });

  if (targets.length < 2 || new Set(targets).size !== targets.length) {
    throw new Error("live reference admit requires at least two distinct targets");
  }
  return targets;
}

function receiptTarget(
  capture: CapturedReference,
  target: string,
  previousHashes: Record<string, string>
): LiveReferenceTargetReceipt {
  const provenance = capture.provenance;
  const failureReason = capture.failureKind === "AVAILABILITY"
    ? "Live target was unavailable after the bounded retry policy."
    : capture.failureKind === "POLICY"
      ? "Live target was rejected by the remote-reference safety policy."
      : capture.failureKind === "COMPILER"
        ? "Live target responded but did not satisfy the capture content contract."
        : undefined;
  const responseSha256 = provenance.responseSha256;
  const previous = previousHashes[target];
  const drift = responseSha256 === undefined
    ? "NOT_OBSERVED" as const
    : previous === undefined
      ? "BASELINE" as const
      : previous === responseSha256
        ? "UNCHANGED" as const
        : "CHANGED" as const;

  return {
    ...(provenance.requestedUrl ? { targetUrl: provenance.requestedUrl } : {}),
    ...(provenance.finalUrl ? { finalUrl: provenance.finalUrl } : {}),
    state: capture.state,
    availability: capture.availability ?? "NOT_ASSESSED",
    ...(capture.failureKind ? { failureKind: capture.failureKind } : {}),
    ...(failureReason ? { failureReason } : {}),
    ...(provenance.httpStatus !== undefined ? { httpStatus: provenance.httpStatus } : {}),
    ...(provenance.contentType ? { contentType: provenance.contentType } : {}),
    ...(provenance.responseBytes !== undefined ? { responseBytes: provenance.responseBytes } : {}),
    ...(responseSha256 ? { responseSha256 } : {}),
    ...(provenance.artifactIdentity ? { artifactIdentity: provenance.artifactIdentity } : {}),
    ...(provenance.capturedAt ? { capturedAt: provenance.capturedAt } : {}),
    dnsResolutions: provenance.dnsResolutions ?? [],
    redirectChain: provenance.redirectChain ?? [],
    ...(provenance.connectedAddress ? { connectedAddress: provenance.connectedAddress } : {}),
    attemptCount: provenance.attemptCount ?? 0,
    observations: capture.facts,
    implementationDetails: "UNKNOWN",
    drift
  };
}

function isInjected(dependencies: LiveReferenceDependencies): boolean {
  return Boolean(
    dependencies.capture ||
    dependencies.transport ||
    dependencies.fetchImpl ||
    dependencies.resolveHost
  );
}

export function assertPublicLiveReceipt(receipt: LiveReferenceReceipt): void {
  const serialized = JSON.stringify(receipt);
  const forbidden = [
    /https?:\/\/[^/\s:@]+:[^@\s]+@/i,
    /[?&](?:token|secret|password|key|signature)=/i,
    /\/(?:Users|private|home|tmp)\//i,
    /(?:cookie|authorization)\s*[=:]/i,
    /(?:^|[^0-9])(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})(?:[^0-9]|$)/,
    /(?:^|[^0-9a-f])(?:::1|fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:|::ffff:(?:7f[0-9a-f]{2}|a9fe|ac1[0-9a-f]|c0a8):)[0-9a-f:]*(?:[^0-9a-f]|$)/i
  ];
  if (forbidden.some((pattern) => pattern.test(serialized))) {
    throw new Error("live reference receipt contains credential, private-network, or machine-private state");
  }
}

export async function verifyLiveReferences(
  admit: LiveReferenceAdmit,
  dependencies: LiveReferenceDependencies = {}
): Promise<LiveReferenceReceipt> {
  const targetsToCapture = normalizedAdmittedTargets(admit);
  const transportMode = isInjected(dependencies) ? "INJECTED" as const : "PRODUCTION" as const;
  const policy = {
    minimumDistinctHttpsTargets: 2 as const,
    timeoutMs: boundedInteger(dependencies.timeoutMs, DEFAULT_POLICY.timeoutMs, 1, 30_000),
    maxAttempts: boundedInteger(dependencies.maxAttempts, DEFAULT_POLICY.maxAttempts, 1, 5),
    retryBackoffMs: boundedInteger(dependencies.retryBackoffMs, DEFAULT_POLICY.retryBackoffMs, 0, 5_000),
    maxRedirects: boundedInteger(dependencies.maxRedirects, DEFAULT_POLICY.maxRedirects, 0, 10),
    maxBytes: boundedInteger(dependencies.maxBytes, DEFAULT_POLICY.maxBytes, 1, 8 * 1024 * 1024)
  };
  const capture = dependencies.capture ?? captureRemoteUrl;
  const captureDependencies: RemoteCaptureDependencies = {
    ...(dependencies.resolveHost ? { resolveHost: dependencies.resolveHost } : {}),
    ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
    ...(dependencies.transport ? { transport: dependencies.transport } : {}),
    ...(dependencies.now ? { now: dependencies.now } : {}),
    ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
    timeoutMs: policy.timeoutMs,
    maxAttempts: policy.maxAttempts,
    retryBackoffMs: policy.retryBackoffMs,
    maxRedirects: policy.maxRedirects,
    maxBytes: policy.maxBytes
  };

  const targets: LiveReferenceTargetReceipt[] = [];
  for (const target of targetsToCapture) {
    const captured = await capture(target, captureDependencies);
    const receipt = receiptTarget(captured, target, dependencies.previousHashes ?? {});
    targets.push(receipt);
    if (receipt.failureKind === "POLICY") break;
  }

  const hasHardFailure = targets.some((target) => target.state === "FAIL");
  const allPass = targets.length === targetsToCapture.length && targets.every((target) => target.state === "PASS");
  const overall = hasHardFailure
    ? "FAIL" as const
    : transportMode === "PRODUCTION" && allPass
      ? "PASS" as const
      : "NOT_EXERCISED" as const;
  const promotionBlockedReason = overall === "PASS"
    ? null
    : transportMode === "INJECTED"
      ? "Injected transport cannot promote live capability evidence."
      : hasHardFailure
        ? "One or more approved live targets failed the public capture policy or content contract."
        : "One or more approved live targets were unavailable, so live capability remains NOT_EXERCISED.";

  const receipt: LiveReferenceReceipt = {
    schema: "website-design-compiler/live-reference-receipt/v2",
    overall,
    executionMode: "LIVE",
    transportMode,
    approval: {
      id: admit.approvalId,
      approvedAt: admit.approvedAt,
      targetCount: targetsToCapture.length
    },
    policy,
    targets,
    promotionBlockedReason
  };
  assertPublicLiveReceipt(receipt);
  return receipt;
}
