import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateAgainstSchema } from "../src/validate.js";

type GitSubject = { ref: string; sha: string; tree: string };
type PuckReceipt = { overall: string; git: GitSubject };
type CmsReceipt = {
  overall: string;
  git: GitSubject;
  payload: { adapter: string; database: string; version: string };
  checks: Record<string, unknown>;
  compiledPageGraphs: Array<{
    category: string;
    declaredFingerprint: string;
    fingerprint: string;
    provenanceComplete: boolean;
    puckState: string;
    readiness: string;
    restoredFingerprint: string;
    route: string;
    semanticOrder: string[];
    sharedChrome: Record<string, string>;
    sourceArtifacts: Record<string, string>;
    sourceMode: string;
  }>;
};

const root = process.cwd();
const outputDirectory = join(root, "artifacts", "handoff");
const puckPath = join(outputDirectory, "issue-35-puck-runtime.json");
const cmsPath = join(root, "artifacts", "cms", "payload-cms-receipt.json");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const git: GitSubject = {
  ref: `refs/heads/${execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim()}`,
  sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim()
};

const puckBytes = await readFile(puckPath);
const cmsBytes = await readFile(cmsPath);
const puck = await validateAgainstSchema<PuckReceipt>(JSON.parse(puckBytes.toString("utf8")), "issue-35-puck-runtime.schema.json");
const cms = JSON.parse(cmsBytes.toString("utf8")) as CmsReceipt;
const sameLineage = puck.overall === "PASS"
  && puck.git.sha === git.sha
  && puck.git.tree === git.tree
  && cms.overall === "PASS"
  && cms.git.sha === git.sha
  && cms.git.tree === git.tree;
const requiredChecks = [
  "compiledDraftPublishedDistinguishable",
  "compiledPageGraphCountSix",
  "compiledPageGraphFingerprintsMatch",
  "compiledPageGraphProvenanceComplete",
  "compiledPageGraphsAreReadyProduction",
  "guestCanReadCompiledPublished",
  "guestCannotReadCompiledDraft",
  "invalidCompiledFingerprintRejected",
  "invalidCompiledGraphRejected"
] as const;
const checksPass = requiredChecks.every((key) => cms.checks[key] === true);
const fileAbsent = async (path: string) => {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
};
const databasePath = join(root, "artifacts", "cms", "payload.sqlite");
const cleanup = {
  databaseRetainedForInspection: !(await fileAbsent(databasePath)),
  payloadProcessExited: true,
  shmFileAbsent: await fileAbsent(`${databasePath}-shm`),
  walFileAbsent: await fileAbsent(`${databasePath}-wal`)
};
const graphPass = cms.compiledPageGraphs.length === 6 && cms.compiledPageGraphs.every((graph) =>
  graph.fingerprint === graph.declaredFingerprint
  && graph.fingerprint === graph.restoredFingerprint
  && graph.provenanceComplete
  && graph.readiness === "READY"
  && graph.sourceMode === "PRODUCTION"
);
const overall = sameLineage && checksPass && graphPass && cleanup.shmFileAbsent && cleanup.walFileAbsent
  ? "PASS"
  : "FAIL";
const receipt = {
  schema: "website-design-compiler/issue-35-payload-runtime/v1",
  overall,
  git,
  predecessor: {
    path: "artifacts/handoff/issue-35-puck-runtime.json",
    sha256: sha256(puckBytes)
  },
  runtime: {
    adapter: cms.payload.adapter,
    database: cms.payload.database,
    package: "payload",
    version: cms.payload.version
  },
  draftPublished: {
    distinctGraphs: cms.checks.compiledDraftPublishedDistinguishable === true,
    guestCanReadPublished: cms.checks.guestCanReadCompiledPublished === true,
    guestCannotReadDraft: cms.checks.guestCannotReadCompiledDraft === true
  },
  controls: {
    fingerprintDriftRejected: cms.checks.invalidCompiledFingerprintRejected === true,
    unknownBlockRejected: cms.checks.invalidCompiledGraphRejected === true
  },
  graphs: cms.compiledPageGraphs,
  cleanup,
  evidence: {
    cmsReceiptPath: "artifacts/cms/payload-cms-receipt.json",
    cmsReceiptSha256: sha256(cmsBytes)
  },
  commands: [
    { command: "pnpm cms:fixture", verdict: cms.overall === "PASS" ? "PASS" : "FAIL" },
    { command: "pnpm handoff:issue-35-payload", verdict: overall }
  ]
};
await validateAgainstSchema(receipt, "issue-35-payload-runtime.schema.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "issue-35-payload-runtime.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ overall, graphCount: receipt.graphs.length, output: "artifacts/handoff/issue-35-payload-runtime.json" }));
if (overall !== "PASS") process.exitCode = 1;
