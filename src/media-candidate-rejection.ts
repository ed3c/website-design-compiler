import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalMediaValue,
  signMediaRequest,
  validateMediaModelPolicy,
  type MediaAdapter,
  type MediaKind,
  type MediaModelPolicy,
  type MediaModelPolicyEntry,
  type MediaRequest
} from "./media-router.js";
import {
  routeProductionMediaGeneration,
  type ProductionProviderPolicy,
  type ProductionProviderTransport
} from "./production-media-provider.js";
import {
  classifyProductionRightsEvidence,
  type RepositoryClearanceReceipt,
  type RightsState,
  type RightsSubject
} from "./repository-rights-clearance.js";
import { validateAgainstSchema } from "./validate.js";

type GitSubject = { sha: string; tree: string; ref: string };
type EvidenceSource = { url: string; sha256: string; bytes: number; verifiedAt: string };
type ProductionRightsSubject = {
  id: string;
  kind: "model" | "generated-output" | "service";
  name: string;
  sourceRevision: string;
  versionOrIdentity: string;
  licenseExpression: string;
  evidence: EvidenceSource[];
  attributionRequired: boolean;
  distributed: boolean;
  geographicRestrictions: string[];
  usageRestrictions: string[];
};
type ProductionRightsEvidence = {
  schema: "website-design-compiler/production-rights-evidence/v2";
  subjects: ProductionRightsSubject[];
};

export interface MediaCandidateRejectionReceipt {
  schema: "website-design-compiler/media-candidate-rejection/v2";
  overall: "PASS" | "NOT_EXERCISED";
  decision: "REJECT";
  generatedAt: string;
  git: GitSubject;
  evidenceAdmission: {
    state: "PASS" | "NOT_EXERCISED";
    channel: "PROTECTED_SHA256";
    observedSha256: string;
    trustedSha256: string | "ABSENT";
    trustedGitTree: string | "ABSENT";
  };
  bindings: {
    policy: { path: "fixtures/media/model-policy.json"; sha256: string };
    rightsEvidence: { path: "rights-production-evidence.json"; sha256: string };
  };
  candidates: Array<{
    modelId: string;
    kind: MediaKind;
    adapter: MediaAdapter;
    versionOrCommit: string;
    rights: {
      model: { subjectId: string; state: RightsState };
      output: { subjectId: string; state: RightsState };
      service: { subjectId: string; state: RightsState };
    };
    sources: EvidenceSource[];
    routing: {
      route: "PRODUCTION_PROVIDER";
      requestSha256: string;
      overall: "NOT_EXERCISED";
      admissionState: "DENIED";
      transportCalls: 0;
      reason: string;
    };
    rejectionReasons: string[];
  }>;
}

function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactSubject(subjects: ProductionRightsSubject[], id: string, kind: ProductionRightsSubject["kind"]): ProductionRightsSubject {
  const matches = subjects.filter((subject) => subject.id === id && subject.kind === kind);
  if (matches.length !== 1) throw new Error(`rights subject ${id} must exist exactly once as ${kind}`);
  return matches[0]!;
}

function sourceInventory(subjects: ProductionRightsSubject[]): EvidenceSource[] {
  const entries = new Map<string, EvidenceSource>();
  for (const source of subjects.flatMap((subject) => subject.evidence)) {
    entries.set(`${source.url}:${source.sha256}`, source);
  }
  return [...entries.values()].sort((left, right) => left.url.localeCompare(right.url));
}

function productionPolicy(entry: MediaModelPolicyEntry): ProductionProviderPolicy {
  if (entry.adapter === "mock") throw new Error(`denied candidate ${entry.id} cannot use the mock adapter`);
  if (!entry.productionIdentity) throw new Error(`denied candidate ${entry.id} lacks an explicit production identity`);
  const { providerId, serviceRevision, modelRevision } = entry.productionIdentity;
  return {
    schema: "website-design-compiler/production-provider-policy/v1",
    identity: {
      providerId,
      serviceRevision,
      modelId: entry.id,
      modelRevision,
      adapter: entry.adapter,
      kind: entry.kind
    },
    rights: {
      modelWeight: { subjectId: entry.provenanceSubjectId, expectedIdentity: modelRevision },
      generatedOutput: {
        subjectId: entry.outputTermsSubjectId,
        expectedIdentity: `${providerId}@${serviceRevision}/${entry.id}@${modelRevision}`
      },
      hostedService: {
        subjectId: entry.serviceTermsSubjectId,
        expectedIdentity: `${providerId}@${serviceRevision}`
      }
    },
    controls: {
      timeoutMs: 100,
      maxAttempts: 1,
      retryBackoffMs: 0,
      requestsPerWindow: 1,
      quotaUnitsPerRequest: 1
    },
    revocations: []
  };
}

function repositoryReceipt(subjects: ProductionRightsSubject[], generatedAt: string): RepositoryClearanceReceipt {
  const projected: RightsSubject[] = subjects.map((subject) => ({
    id: subject.id,
    kind: subject.kind,
    name: subject.name,
    versionOrIdentity: subject.versionOrIdentity,
    licenseExpression: subject.licenseExpression,
    state: classifyProductionRightsEvidence(subject.licenseExpression),
    evidence: subject.evidence.flatMap((source) => [
      `${source.url}#sha256=${source.sha256}`,
      `bytes:${source.bytes}`,
      `verified-at:${source.verifiedAt}`
    ]),
    attributionRequired: subject.attributionRequired,
    distributed: subject.distributed,
    geographicRestrictions: subject.geographicRestrictions,
    usageRestrictions: subject.usageRestrictions
  }));
  const counts: RepositoryClearanceReceipt["counts"] = {
    ALLOW: 0,
    REVIEW_REQUIRED: 0,
    DENY: 0,
    UNKNOWN: 0,
    NOT_DISTRIBUTED: 0
  };
  for (const subject of projected) counts[subject.state] += 1;
  const unresolved = projected.filter((subject) => subject.distributed && subject.state !== "ALLOW").map((subject) => subject.id);
  return {
    schema: "website-design-compiler/repository-rights-clearance/v2",
    overall: unresolved.length === 0 ? "PASS" : "FAIL",
    generatedAt,
    subjects: projected,
    counts,
    unresolved,
    expiredWaivers: [],
    diagnostics: [],
    noticeSubjects: projected.filter((subject) => subject.distributed && subject.attributionRequired).map((subject) => subject.id),
    legalDisclaimer: "ENGINEERING_CLEARANCE_NOT_LEGAL_ADVICE"
  };
}

export async function buildMediaCandidateRejectionReceipt(
  root: string,
  git: GitSubject,
  now = new Date(),
  trustedRightsEvidenceSha256?: string,
  trustedGitTree?: string
): Promise<MediaCandidateRejectionReceipt> {
  const policyPath = join(root, "fixtures", "media", "model-policy.json");
  const rightsPath = join(root, "rights-production-evidence.json");
  const [policyBytes, rightsBytes] = await Promise.all([readFile(policyPath), readFile(rightsPath)]);
  const policy = JSON.parse(policyBytes.toString("utf8")) as MediaModelPolicy;
  const rights = await validateAgainstSchema<ProductionRightsEvidence>(
    JSON.parse(rightsBytes.toString("utf8")) as unknown,
    "production-rights-evidence.schema.json"
  );
  const policyErrors = validateMediaModelPolicy(policy);
  if (policyErrors.length > 0) throw new Error(`invalid media policy: ${policyErrors.join("; ")}`);
  const observedRightsEvidenceSha256 = digest(rightsBytes);
  if (trustedRightsEvidenceSha256 && !/^[a-f0-9]{64}$/.test(trustedRightsEvidenceSha256)) {
    throw new Error("production rights evidence externally trusted SHA-256 is malformed");
  }
  if (trustedRightsEvidenceSha256 && trustedRightsEvidenceSha256 !== observedRightsEvidenceSha256) {
    throw new Error("production rights evidence does not match the externally trusted SHA-256");
  }
  if (trustedGitTree && !/^[a-f0-9]{40}$/.test(trustedGitTree)) {
    throw new Error("production candidate externally trusted Git tree is malformed");
  }
  if (trustedGitTree && trustedGitTree !== git.tree) {
    throw new Error("production candidate does not match the externally trusted Git tree");
  }
  if (Boolean(trustedRightsEvidenceSha256) !== Boolean(trustedGitTree)) {
    throw new Error("production candidate external admission requires both rights evidence SHA-256 and Git tree");
  }
  const externallyAdmitted = Boolean(trustedRightsEvidenceSha256 && trustedGitTree);
  const denied = policy.entries.filter((entry) => entry.admission === "DENY" && entry.adapter !== "mock");
  if (denied.length === 0) throw new Error("no denied production media candidates are configured");

  const candidates: MediaCandidateRejectionReceipt["candidates"] = [];
  for (const entry of denied) {
    const model = exactSubject(rights.subjects, entry.provenanceSubjectId, "model");
    const output = exactSubject(rights.subjects, entry.outputTermsSubjectId, "generated-output");
    const service = exactSubject(rights.subjects, entry.serviceTermsSubjectId, "service");
    for (const subject of [model, output, service]) {
      if (subject.sourceRevision !== entry.versionOrCommit) {
        throw new Error(`${subject.id} source revision ${subject.sourceRevision} does not match policy ${entry.versionOrCommit}`);
      }
    }
    const modelState = classifyProductionRightsEvidence(model.licenseExpression);
    if (modelState !== "DENY") throw new Error(`denied model ${entry.id} lacks a deny-classified model-weight license`);

    const formalPolicy = productionPolicy(entry);
    const formalRights = repositoryReceipt([model, output, service], now.toISOString());
    let transportCalls = 0;
    const transport: ProductionProviderTransport = {
      identity: formalPolicy.identity,
      async generate() {
        transportCalls += 1;
        throw new Error("denied candidate production transport must never execute");
      }
    };
    const request: MediaRequest = {
      schema: "website-design-compiler/media-request/v1",
      requestId: `candidate-rejection-${entry.id}`,
      kind: entry.kind,
      modelId: entry.id,
      prompt: "Governed negative-control request; execution is forbidden.",
      parameters: { negativeControl: true },
      optimization: { target: "web", maxBytes: 1 }
    };
    const secret = "ephemeral-candidate-rejection-secret";
    const result = await routeProductionMediaGeneration({
      signed: { request, signature: signMediaRequest(request, secret) },
      secret,
      policy: formalPolicy,
      rightsReceipt: formalRights,
      transport,
      now
    });
    if (transportCalls !== 0 || result.receipt.overall !== "NOT_EXERCISED" || result.receipt.admissionState !== "DENIED" || result.asset || !result.receipt.reason.includes("rights state is DENY")) {
      throw new Error(`denied candidate ${entry.id} did not fail before production transport execution`);
    }
    const rejectionReasons = [entry.reason, ...model.usageRestrictions, ...output.usageRestrictions]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (rejectionReasons.length === 0) throw new Error(`denied candidate ${entry.id} has no rejection reasons`);
    candidates.push({
      modelId: entry.id,
      kind: entry.kind,
      adapter: entry.adapter,
      versionOrCommit: entry.versionOrCommit,
      rights: {
        model: { subjectId: model.id, state: modelState },
        output: { subjectId: output.id, state: classifyProductionRightsEvidence(output.licenseExpression) },
        service: { subjectId: service.id, state: classifyProductionRightsEvidence(service.licenseExpression) }
      },
      sources: sourceInventory([model, output, service]),
      routing: {
        route: "PRODUCTION_PROVIDER",
        requestSha256: digest(canonicalMediaValue(request)),
        overall: "NOT_EXERCISED",
        admissionState: "DENIED",
        transportCalls: 0,
        reason: result.receipt.reason
      },
      rejectionReasons
    });
  }

  const receipt: MediaCandidateRejectionReceipt = {
    schema: "website-design-compiler/media-candidate-rejection/v2",
    overall: externallyAdmitted ? "PASS" : "NOT_EXERCISED",
    decision: "REJECT",
    generatedAt: now.toISOString(),
    git,
    evidenceAdmission: {
      state: externallyAdmitted ? "PASS" : "NOT_EXERCISED",
      channel: "PROTECTED_SHA256",
      observedSha256: observedRightsEvidenceSha256,
      trustedSha256: trustedRightsEvidenceSha256 ?? "ABSENT",
      trustedGitTree: trustedGitTree ?? "ABSENT"
    },
    bindings: {
      policy: { path: "fixtures/media/model-policy.json", sha256: digest(policyBytes) },
      rightsEvidence: { path: "rights-production-evidence.json", sha256: digest(rightsBytes) }
    },
    candidates,
  };
  await validateAgainstSchema(receipt, "media-candidate-rejection.schema.json");
  return receipt;
}
