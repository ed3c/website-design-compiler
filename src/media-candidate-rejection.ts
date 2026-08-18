import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalMediaValue,
  routeMediaGeneration,
  signMediaRequest,
  validateMediaModelPolicy,
  type MediaAdapter,
  type MediaKind,
  type MediaModelPolicy,
  type MediaRequest,
  type MediaWorker
} from "./media-router.js";
import { classifyProductionRightsEvidence, type RightsState } from "./repository-rights-clearance.js";
import { validateAgainstSchema } from "./validate.js";

type GitSubject = { sha: string; tree: string; ref: string };
type EvidenceSource = { url: string; sha256: string; bytes: number; verifiedAt: string };
type ProductionRightsSubject = {
  id: string;
  kind: "model" | "generated-output" | "service";
  name: string;
  versionOrIdentity: string;
  licenseExpression: string;
  evidence: EvidenceSource[];
  attributionRequired: boolean;
  distributed: boolean;
  geographicRestrictions: string[];
  usageRestrictions: string[];
};
type ProductionRightsEvidence = {
  schema: "website-design-compiler/production-rights-evidence/v1";
  subjects: ProductionRightsSubject[];
};

export interface MediaCandidateRejectionReceipt {
  schema: "website-design-compiler/media-candidate-rejection/v1";
  overall: "PASS";
  decision: "REJECT";
  generatedAt: string;
  git: GitSubject;
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
    routing: { requestSha256: string; overall: "FAIL"; workerCalls: 0; reason: string };
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

export async function buildMediaCandidateRejectionReceipt(
  root: string,
  git: GitSubject,
  now = new Date()
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
  const denied = policy.entries.filter((entry) => entry.admission === "DENY" && entry.adapter !== "mock");
  if (denied.length === 0) throw new Error("no denied production media candidates are configured");

  const candidates: MediaCandidateRejectionReceipt["candidates"] = [];
  for (const entry of denied) {
    const model = exactSubject(rights.subjects, entry.provenanceSubjectId, "model");
    const output = exactSubject(rights.subjects, entry.outputTermsSubjectId, "generated-output");
    const service = exactSubject(rights.subjects, entry.serviceTermsSubjectId, "service");
    const modelState = classifyProductionRightsEvidence(model.licenseExpression);
    if (modelState !== "DENY") throw new Error(`denied model ${entry.id} lacks a deny-classified model-weight license`);

    let workerCalls = 0;
    const worker: MediaWorker = {
      adapter: entry.adapter,
      async generate() {
        workerCalls += 1;
        throw new Error("denied candidate worker must never execute");
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
    const result = await routeMediaGeneration({
      signed: { request, signature: signMediaRequest(request, secret) },
      secret,
      policy,
      workers: { [entry.adapter]: worker }
    });
    if (workerCalls !== 0 || result.receipt.overall !== "FAIL" || result.asset || !result.receipt.reason?.includes("DENY")) {
      throw new Error(`denied candidate ${entry.id} did not fail before worker execution`);
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
        requestSha256: digest(canonicalMediaValue(request)),
        overall: "FAIL",
        workerCalls: 0,
        reason: result.receipt.reason
      },
      rejectionReasons
    });
  }

  const receipt: MediaCandidateRejectionReceipt = {
    schema: "website-design-compiler/media-candidate-rejection/v1",
    overall: "PASS",
    decision: "REJECT",
    generatedAt: now.toISOString(),
    git,
    bindings: {
      policy: { path: "fixtures/media/model-policy.json", sha256: digest(policyBytes) },
      rightsEvidence: { path: "rights-production-evidence.json", sha256: digest(rightsBytes) }
    },
    candidates,
  };
  await validateAgainstSchema(receipt, "media-candidate-rejection.schema.json");
  return receipt;
}
