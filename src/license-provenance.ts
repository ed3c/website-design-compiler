import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";

export type SubjectKind = "code" | "model" | "font" | "asset" | "generated-output" | "hosted-service";
export type SubjectRole = "product-core" | "optional" | "development";
export type Decision = "ALLOW" | "REVIEW_REQUIRED" | "DENY" | "UNKNOWN";

export interface LicensePolicy {
  version: number;
  allow: string[];
  review: string[];
  deny_product_core: string[];
  rules: {
    unknown_license: "fail";
    preserve_notices: boolean;
    require_exact_version_or_commit: boolean;
    require_model_license: boolean;
    require_generated_output_terms: boolean;
    require_asset_hash: boolean;
    require_attribution_record: boolean;
  };
}

export interface RightsEvidence {
  license?: string;
  source?: string;
  attribution?: string;
  kind?: SubjectKind;
  role?: SubjectRole;
  hashSha256?: string;
  outputTerms?: string;
}

export interface ProvenanceSubject extends RightsEvidence {
  id: string;
  versionOrCommit?: string;
  kind: SubjectKind;
  role: SubjectRole;
}

export interface SubjectResult {
  subject: ProvenanceSubject;
  decision: Decision;
  reasons: string[];
}

export interface LicenseReceipt {
  schema: "website-design-compiler/license-receipt/v1";
  overall: "PASS" | "REVIEW_REQUIRED" | "FAIL";
  subjects: SubjectResult[];
  reviewQueue: string[];
  denied: string[];
  unknown: string[];
}

export async function loadLicensePolicy(path = resolve(process.cwd(), "policies/licenses.yaml")): Promise<LicensePolicy> {
  return parse(await readFile(path, "utf8")) as LicensePolicy;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function classifySubject(subject: ProvenanceSubject, policy: LicensePolicy): SubjectResult {
  const reasons: string[] = [];
  let decision: Decision = "ALLOW";

  if (!subject.license) {
    decision = "UNKNOWN";
    reasons.push("missing license evidence");
  } else if (subject.role === "product-core" && policy.deny_product_core.includes(subject.license)) {
    decision = "DENY";
    reasons.push(`license ${subject.license} is denied for product-core use`);
  } else if (policy.review.includes(subject.license)) {
    decision = "REVIEW_REQUIRED";
    reasons.push(`license ${subject.license} requires review`);
  } else if (!policy.allow.includes(subject.license)) {
    decision = "UNKNOWN";
    reasons.push(`license ${subject.license} is not classified by policy`);
  }

  if (policy.rules.require_exact_version_or_commit && !subject.versionOrCommit) {
    decision = "UNKNOWN";
    reasons.push("missing exact version or commit");
  }
  if (policy.rules.require_attribution_record && !subject.attribution) {
    decision = "UNKNOWN";
    reasons.push("missing attribution record");
  }
  if (subject.kind === "model" && policy.rules.require_model_license && !subject.license) {
    decision = "UNKNOWN";
    reasons.push("missing model-weight license");
  }
  if (subject.kind === "generated-output" && policy.rules.require_generated_output_terms && !subject.outputTerms) {
    decision = "UNKNOWN";
    reasons.push("missing generated-output terms");
  }
  if ((subject.kind === "asset" || subject.kind === "generated-output") && policy.rules.require_asset_hash && !subject.hashSha256) {
    decision = "UNKNOWN";
    reasons.push("missing asset hash");
  }

  return { subject, decision, reasons };
}

export function buildLicenseReceipt(subjects: ProvenanceSubject[], policy: LicensePolicy): LicenseReceipt {
  const results = subjects.map((subject) => classifySubject(subject, policy));
  const reviewQueue = results.filter((result) => result.decision === "REVIEW_REQUIRED").map((result) => result.subject.id);
  const denied = results.filter((result) => result.decision === "DENY").map((result) => result.subject.id);
  const unknown = results.filter((result) => result.decision === "UNKNOWN").map((result) => result.subject.id);
  const overall = denied.length > 0 || unknown.length > 0 ? "FAIL" : reviewQueue.length > 0 ? "REVIEW_REQUIRED" : "PASS";
  return {
    schema: "website-design-compiler/license-receipt/v1",
    overall,
    subjects: results,
    reviewQueue,
    denied,
    unknown
  };
}

function exactVersionFromImporter(lock: unknown, importer: string, section: "dependencies" | "devDependencies", name: string): string | undefined {
  if (!lock || typeof lock !== "object") return undefined;
  const importers = (lock as Record<string, unknown>).importers;
  if (!importers || typeof importers !== "object") return undefined;
  const selected = (importers as Record<string, unknown>)[importer];
  if (!selected || typeof selected !== "object") return undefined;
  const dependencies = (selected as Record<string, unknown>)[section];
  if (!dependencies || typeof dependencies !== "object") return undefined;
  const entry = (dependencies as Record<string, unknown>)[name];
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const version = (entry as Record<string, unknown>).version;
    if (typeof version === "string") return version;
  }
  return undefined;
}

export async function scanWorkspace(
  packageJsonPath: string,
  pnpmLockPath: string,
  rightsEvidencePath: string,
  policyPath = resolve(process.cwd(), "policies/licenses.yaml")
): Promise<LicenseReceipt> {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
  const lock = parse(await readFile(pnpmLockPath, "utf8")) as unknown;
  const evidence = JSON.parse(await readFile(rightsEvidencePath, "utf8")) as Record<string, RightsEvidence>;
  const policy = await loadLicensePolicy(policyPath);
  const subjects: ProvenanceSubject[] = [];

  for (const [section, role] of [["dependencies", "product-core"], ["devDependencies", "development"]] as const) {
    const declared = packageJson[section];
    if (!declared || typeof declared !== "object") continue;
    for (const name of Object.keys(declared as Record<string, unknown>).sort()) {
      const rights = evidence[name] ?? {};
      subjects.push({
        id: `package:${name}`,
        kind: rights.kind ?? "code",
        role: rights.role ?? role,
        license: rights.license,
        source: rights.source,
        attribution: rights.attribution,
        hashSha256: rights.hashSha256,
        outputTerms: rights.outputTerms,
        versionOrCommit: exactVersionFromImporter(lock, ".", section, name)
      });
    }
  }

  return buildLicenseReceipt(subjects, policy);
}

export async function writeLicenseReceipt(receipt: LicenseReceipt, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}
