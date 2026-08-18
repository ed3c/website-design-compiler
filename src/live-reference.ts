import type { EvidenceState } from "./contracts.js";
import {
  captureRemoteUrl,
  isPublicIpAddress,
  type CapturedReference,
  type RemoteCaptureDependencies,
  type RemoteDnsResolution,
  type RemoteRedirectEvidence
} from "./reference-capture.js";

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
  attemptCount: number;
  observations: string[];
  implementationDetails: "UNKNOWN";
}

export interface LiveReferenceReceipt {
  schema: "website-design-compiler/live-reference-receipt/v1";
  mode: "LIVE_THIRD_PARTY_OPT_IN";
  overall: EvidenceState;
  startedAt: string;
  completedAt: string;
  policy: {
    minimumDistinctHttpsTargets: 2;
    timeoutMs: number;
    maxAttempts: number;
    retryBackoffMs: number;
    maxRedirects: number;
    maxBytes: number;
  };
  targets: LiveReferenceTargetReceipt[];
  reason?: string;
}

export interface LiveReferenceDependencies extends RemoteCaptureDependencies {
  capture?: (target: string, dependencies: RemoteCaptureDependencies) => Promise<CapturedReference>;
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

function receiptTarget(capture: CapturedReference): LiveReferenceTargetReceipt {
  const provenance = capture.provenance;
  const failureReason = capture.failureKind === "AVAILABILITY"
    ? "Live target was unavailable after the bounded retry policy."
    : capture.failureKind === "POLICY"
      ? "Live target was rejected by the remote-reference safety policy."
      : capture.failureKind === "COMPILER"
        ? "Live target responded but did not satisfy the capture content contract."
        : undefined;

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
    ...(provenance.responseSha256 ? { responseSha256: provenance.responseSha256 } : {}),
    ...(provenance.artifactIdentity ? { artifactIdentity: provenance.artifactIdentity } : {}),
    ...(provenance.capturedAt ? { capturedAt: provenance.capturedAt } : {}),
    dnsResolutions: provenance.dnsResolutions ?? [],
    redirectChain: provenance.redirectChain ?? [],
    attemptCount: provenance.attemptCount ?? 0,
    observations: capture.facts,
    implementationDetails: "UNKNOWN"
  };
}

function receiptState(targets: LiveReferenceTargetReceipt[]): EvidenceState {
  if (targets.some((target) => target.state === "FAIL")) return "FAIL";
  if (targets.every((target) => target.state === "PASS")) return "PASS";
  return "NOT_EXERCISED";
}

export async function buildLiveReferenceReceipt(
  targetValues: string[],
  dependencies: LiveReferenceDependencies = {}
): Promise<LiveReferenceReceipt> {
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const policy = {
    minimumDistinctHttpsTargets: 2 as const,
    timeoutMs: boundedInteger(dependencies.timeoutMs, DEFAULT_POLICY.timeoutMs, 1, 30_000),
    maxAttempts: boundedInteger(dependencies.maxAttempts, DEFAULT_POLICY.maxAttempts, 1, 5),
    retryBackoffMs: boundedInteger(dependencies.retryBackoffMs, DEFAULT_POLICY.retryBackoffMs, 0, 5_000),
    maxRedirects: boundedInteger(dependencies.maxRedirects, DEFAULT_POLICY.maxRedirects, 0, 10),
    maxBytes: boundedInteger(dependencies.maxBytes, DEFAULT_POLICY.maxBytes, 1, 8 * 1024 * 1024)
  };
  const normalizedTargets: string[] = [];

  for (const value of targetValues) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return {
        schema: "website-design-compiler/live-reference-receipt/v1",
        mode: "LIVE_THIRD_PARTY_OPT_IN",
        overall: "FAIL",
        startedAt,
        completedAt: now().toISOString(),
        policy,
        targets: [],
        reason: "Every live reference target must be an absolute HTTPS URL."
      };
    }
    if (url.protocol !== "https:") {
      return {
        schema: "website-design-compiler/live-reference-receipt/v1",
        mode: "LIVE_THIRD_PARTY_OPT_IN",
        overall: "FAIL",
        startedAt,
        completedAt: now().toISOString(),
        policy,
        targets: [],
        reason: "Every live reference target must be an absolute HTTPS URL."
      };
    }
    const hostname = url.hostname.toLowerCase();
    const privateHostname = hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal");
    const literalIpIsPrivate = /^[\d.]+$/.test(hostname) || hostname.includes(":")
      ? !isPublicIpAddress(hostname.replace(/^\[|\]$/g, ""))
      : false;
    if (url.username || url.password || url.search || url.hash || privateHostname || literalIpIsPrivate) {
      return {
        schema: "website-design-compiler/live-reference-receipt/v1",
        mode: "LIVE_THIRD_PARTY_OPT_IN",
        overall: "FAIL",
        startedAt,
        completedAt: now().toISOString(),
        policy,
        targets: [],
        reason: "A live reference target was rejected by the public-evidence URL policy."
      };
    }
    normalizedTargets.push(url.toString());
  }

  if (new Set(normalizedTargets).size < policy.minimumDistinctHttpsTargets) {
    return {
      schema: "website-design-compiler/live-reference-receipt/v1",
      mode: "LIVE_THIRD_PARTY_OPT_IN",
      overall: "NOT_EXERCISED",
      startedAt,
      completedAt: now().toISOString(),
      policy,
      targets: [],
      reason: "At least two distinct public HTTPS targets must be explicitly configured before the live lane can run."
    };
  }

  const capture = dependencies.capture ?? captureRemoteUrl;
  const targets = await Promise.all(normalizedTargets.map(async (target) => receiptTarget(await capture(target, dependencies))));
  return {
    schema: "website-design-compiler/live-reference-receipt/v1",
    mode: "LIVE_THIRD_PARTY_OPT_IN",
    overall: receiptState(targets),
    startedAt,
    completedAt: now().toISOString(),
    policy,
    targets
  };
}
