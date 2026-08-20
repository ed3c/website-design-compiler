import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAgainstSchema } from "../src/validate.js";
import { ARENA_CATEGORIES } from "../src/arena.js";

export const OWNING_CLOSURE_COMMANDS = [
  "pnpm typecheck",
  "pnpm build",
  "pnpm test",
  "pnpm v2:complete-page-graph",
  "pnpm authoring:receipt",
  "pnpm cms:fixture",
  "pnpm ui:typecheck",
  "pnpm ui:build",
  "pnpm browser:typecheck",
  "pnpm browser:qa",
  "pnpm browser:receipt"
] as const;

const categories = ARENA_CATEGORIES;
const screenshotProjects = ["desktop-chromium", "tablet-chromium", "mobile-chromium"] as const;
const runtimeProjects = [...screenshotProjects, "reduced-motion-chromium"] as const;
const commandResultsSchema = "website-design-compiler/issue-35-closure-command-results/v1";
const generatedPageTestTitle = (category: string) => `${category} generated page consumes responsive and motion contracts`;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

type Verdict = "PASS" | "FAIL" | "NOT_EXERCISED";
type ControlState = Verdict | "ABSENT";
type EvidenceState = "PASS" | "FAIL" | "ABSENT";
type GitSubject = { ref: string; sha: string; tree: string };
type EvidenceRef = { path: string; sha256: string };
export type ClosureCommand = { command: string; verdict: Verdict; exitCode: number | null; evidence: EvidenceRef[] };
type Cleanup = {
  state: Verdict;
  devServer: Verdict;
  playwright: Verdict;
  payload: Verdict;
  temporaryRuntimeState: Verdict;
  retainedEvidence: string[];
};
type ResidualLane = { lane: string; state: "NOT_EXERCISED"; reason: string };

type PuckReceipt = {
  overall: string;
  git: GitSubject;
  graphs: Array<{ category: string; fingerprint: string; publishedFingerprint: string; renderedSemanticOrder: string[]; semanticOrder: string[] }>;
};
type PayloadReceipt = {
  overall: string;
  git: GitSubject;
  predecessor: EvidenceRef;
  graphs: Array<{ category: string; declaredFingerprint: string; fingerprint: string; restoredFingerprint: string; semanticOrder: string[] }>;
};
type GeneratedPageReceipt = {
  overall: string;
  git: { sha: string; ref: string };
  expected: { categories: number; projects: number; screenshots: number; qualityObservations: number };
  observed: { categories: number; projects: number; screenshots: number; distinctHashes: number; qualityObservations: number };
  evidence: Array<{ category: string; project: string; path: string; sha256: string }>;
  qualityEvidence: Array<{ category: string; project: string }>;
  missing: string[];
};

const defaultCleanup = (): Cleanup => ({
  state: "NOT_EXERCISED",
  devServer: "NOT_EXERCISED",
  playwright: "NOT_EXERCISED",
  payload: "NOT_EXERCISED",
  temporaryRuntimeState: "NOT_EXERCISED",
  retainedEvidence: []
});
const defaultCommands = (): ClosureCommand[] => OWNING_CLOSURE_COMMANDS.map((command) => ({ command, verdict: "NOT_EXERCISED", exitCode: null, evidence: [] }));
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const isHash = (value: unknown, length: 40 | 64): value is string => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const isVerdict = (value: unknown): value is Verdict => value === "PASS" || value === "FAIL" || value === "NOT_EXERCISED";
const arraysEqual = (left: string[], right: string[]) => left.length === right.length && left.every((entry, index) => entry === right[index]);
const sameGit = (left: GitSubject, right: GitSubject) => left.sha === right.sha && left.tree === right.tree && left.ref === right.ref;
const isSafeRelativePath = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !isAbsolute(value) && !value.split(/[\\/]/).includes("..");

export function evaluateCommandResults(value: unknown, git: GitSubject): {
  commands: ClosureCommand[];
  cleanup: Cleanup;
  residualNotExercised: ResidualLane[];
  sameLineage: ControlState;
  state: EvidenceState;
  failures: string[];
} {
  const failures: string[] = [];
  if (!isRecord(value)) return { commands: defaultCommands(), cleanup: defaultCleanup(), residualNotExercised: [], sameLineage: "ABSENT", state: "ABSENT", failures: ["command-results:absent"] };
  if (value.schema !== commandResultsSchema) failures.push("command-results:schema");
  if (!onlyKeys(value, ["schema", "git", "commands", "cleanup", "residualNotExercised"])) failures.push("command-results:unexpected-property");

  let sameLineage: ControlState = "FAIL";
  if (isRecord(value.git) && onlyKeys(value.git, ["ref", "sha", "tree"]) && typeof value.git.ref === "string" && isHash(value.git.sha, 40) && isHash(value.git.tree, 40)) {
    sameLineage = sameGit(value.git as GitSubject, git) ? "PASS" : "FAIL";
  } else failures.push("command-results:git");
  if (sameLineage !== "PASS") failures.push("command-results:lineage");

  const parsedCommands: ClosureCommand[] = [];
  if (!Array.isArray(value.commands) || value.commands.length !== OWNING_CLOSURE_COMMANDS.length) failures.push("command-results:command-count");
  for (const [index, expected] of OWNING_CLOSURE_COMMANDS.entries()) {
    const candidate = Array.isArray(value.commands) ? value.commands[index] : null;
    if (!isRecord(candidate) || !onlyKeys(candidate, ["command", "verdict", "exitCode", "evidence"])) {
      parsedCommands.push({ command: expected, verdict: "NOT_EXERCISED", exitCode: null, evidence: [] });
      failures.push(`command-results:${expected}:shape`);
      continue;
    }
    const evidence: EvidenceRef[] = [];
    let evidenceValid = Array.isArray(candidate.evidence);
    if (Array.isArray(candidate.evidence)) {
      for (const entry of candidate.evidence) {
        if (!isRecord(entry) || !onlyKeys(entry, ["path", "sha256"]) || !isSafeRelativePath(entry.path) || !isHash(entry.sha256, 64)) evidenceValid = false;
        else evidence.push({ path: entry.path, sha256: entry.sha256 });
      }
    }
    const verdictValid = isVerdict(candidate.verdict);
    const exitCodeValid = candidate.exitCode === null || Number.isInteger(candidate.exitCode);
    const identityValid = candidate.command === expected;
    if (!identityValid || !verdictValid || !exitCodeValid || !evidenceValid) failures.push(`command-results:${expected}:invalid`);
    const verdict: Verdict = isVerdict(candidate.verdict) ? candidate.verdict : "NOT_EXERCISED";
    const exitCode = exitCodeValid ? candidate.exitCode as number | null : null;
    if (verdict === "PASS" && exitCode !== 0) failures.push(`command-results:${expected}:pass-without-zero-exit`);
    if (verdict !== "PASS" || exitCode !== 0) failures.push(`command-results:${expected}:not-pass`);
    parsedCommands.push({ command: expected, verdict, exitCode, evidence });
  }

  let cleanup = defaultCleanup();
  if (isRecord(value.cleanup) && onlyKeys(value.cleanup, ["state", "devServer", "playwright", "payload", "temporaryRuntimeState", "retainedEvidence"])
    && isVerdict(value.cleanup.state) && isVerdict(value.cleanup.devServer) && isVerdict(value.cleanup.playwright) && isVerdict(value.cleanup.payload)
    && isVerdict(value.cleanup.temporaryRuntimeState) && Array.isArray(value.cleanup.retainedEvidence) && value.cleanup.retainedEvidence.every(isSafeRelativePath)) {
    cleanup = value.cleanup as Cleanup;
  } else failures.push("command-results:cleanup-shape");
  for (const [name, verdict] of Object.entries(cleanup).filter(([key]) => key !== "retainedEvidence")) if (verdict !== "PASS") failures.push(`cleanup:${name}:not-pass`);

  const residualNotExercised: ResidualLane[] = [];
  if (!Array.isArray(value.residualNotExercised)) failures.push("command-results:residual-shape");
  else for (const lane of value.residualNotExercised) {
    if (!isRecord(lane) || !onlyKeys(lane, ["lane", "state", "reason"]) || typeof lane.lane !== "string" || lane.lane.length === 0 || lane.state !== "NOT_EXERCISED" || typeof lane.reason !== "string" || lane.reason.length === 0) failures.push("command-results:residual-invalid");
    else residualNotExercised.push(lane as ResidualLane);
  }
  return { commands: parsedCommands, cleanup, residualNotExercised, sameLineage, state: failures.length === 0 ? "PASS" : "FAIL", failures };
}

type PlaywrightSpec = { title?: unknown; file?: unknown; ok?: unknown; tests?: unknown };
function collectSpecs(value: unknown, specs: PlaywrightSpec[] = []): PlaywrightSpec[] {
  if (!isRecord(value)) return specs;
  if (Array.isArray(value.specs)) for (const spec of value.specs) if (isRecord(spec)) specs.push(spec);
  if (Array.isArray(value.suites)) for (const suite of value.suites) collectSpecs(suite, specs);
  return specs;
}

export function summarizeGeneratedPageReport(report: unknown, source: string | null): {
  state: EvidenceState;
  expectedCases: 24;
  passedCases: number;
  semanticOrder: ControlState;
  horizontalOverflow: ControlState;
  missing: string[];
  failed: string[];
} {
  if (!isRecord(report)) return { state: "ABSENT", expectedCases: 24, passedCases: 0, semanticOrder: "ABSENT", horizontalOverflow: "ABSENT", missing: [], failed: [] };
  const expected = new Set(categories.flatMap((category) => runtimeProjects.map((project) => `${category}/${project}`)));
  const passed = new Set<string>();
  const failed = new Set<string>();
  for (const spec of collectSpecs(report)) {
    if (spec.file !== "generated-pages.spec.ts" || typeof spec.title !== "string" || !Array.isArray(spec.tests)) continue;
    const category = categories.find((entry) => spec.title === generatedPageTestTitle(entry));
    if (!category) continue;
    for (const test of spec.tests) {
      if (!isRecord(test) || typeof test.projectName !== "string") continue;
      const key = `${category}/${test.projectName}`;
      if (!expected.has(key)) continue;
      const results = Array.isArray(test.results) ? test.results : [];
      const last = results.at(-1);
      const casePassed = spec.ok === true && test.status === "expected" && isRecord(last) && last.status === "passed";
      (casePassed ? passed : failed).add(key);
    }
  }
  const missing = [...expected].filter((key) => !passed.has(key) && !failed.has(key)).sort();
  const failedCases = [...failed].sort();
  const matrixPass = passed.size === expected.size && missing.length === 0 && failedCases.length === 0;
  const semanticAssertion = source?.includes("expect(indices).toEqual(indices.map((_,index)=>index))") === true;
  const overflowAssertion = source?.includes("expect(runtimeLayout.documentHorizontalOverflow") === true
    && source.includes("expect(runtimeLayout.nodeHorizontalOverflow")
    && source.includes("expect(runtimeLayout.unsafeHorizontalScroll");
  return {
    state: matrixPass && semanticAssertion && overflowAssertion ? "PASS" : "FAIL",
    expectedCases: 24,
    passedCases: passed.size,
    semanticOrder: matrixPass && semanticAssertion ? "PASS" : "FAIL",
    horizontalOverflow: matrixPass && overflowAssertion ? "PASS" : "FAIL",
    missing,
    failed: failedCases
  };
}

function currentGit(): GitSubject & { trackedWorktreeClean: boolean } {
  const ref = execFileSync("git", ["symbolic-ref", "--quiet", "HEAD"], { encoding: "utf8" }).trim();
  return {
    ref,
    sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
    trackedWorktreeClean: execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() === ""
  };
}

async function readValidatedReceipt<T>(path: string, schema: string): Promise<{ state: EvidenceState; bytes: Buffer | null; value: T | null }> {
  try {
    const bytes = await readFile(path);
    const value = await validateAgainstSchema<T>(JSON.parse(bytes.toString("utf8")), schema);
    return { state: "PASS", bytes, value };
  } catch (error) {
    return { state: isRecord(error) && error.code === "ENOENT" ? "ABSENT" : "FAIL", bytes: null, value: null };
  }
}

async function main() {
  const root = process.cwd();
  const git = currentGit();
  const gitSubject: GitSubject = { ref: git.ref, sha: git.sha, tree: git.tree };
  const failures: string[] = [];
  if (!git.trackedWorktreeClean) failures.push("git:tracked-worktree-dirty");
  const handoffDirectory = join(root, "artifacts", "handoff");
  const puckRelative = "artifacts/handoff/issue-35-puck-runtime.json";
  const payloadRelative = "artifacts/handoff/issue-35-payload-runtime.json";
  const browserRelative = "artifacts/generated-pages/generated-page-browser-receipt.json";
  const reportRelative = "artifacts/browser-qa/playwright-report.json";
  const sourceRelative = "tests/browser/generated-pages.spec.ts";

  const puckRead = await readValidatedReceipt<PuckReceipt>(join(root, puckRelative), "issue-35-puck-runtime.schema.json");
  const payloadRead = await readValidatedReceipt<PayloadReceipt>(join(root, payloadRelative), "issue-35-payload-runtime.schema.json");
  const puckDigest = puckRead.bytes ? sha256(puckRead.bytes) : null;
  const payloadDigest = payloadRead.bytes ? sha256(payloadRead.bytes) : null;
  const puckLineage: ControlState = puckRead.value ? (sameGit(puckRead.value.git, gitSubject) ? "PASS" : "FAIL") : puckRead.state;
  const payloadLineage: ControlState = payloadRead.value ? (sameGit(payloadRead.value.git, gitSubject) ? "PASS" : "FAIL") : payloadRead.state;
  const puckPass = puckRead.state === "PASS" && puckRead.value?.overall === "PASS" && puckLineage === "PASS";
  const payloadPass = payloadRead.state === "PASS" && payloadRead.value?.overall === "PASS" && payloadLineage === "PASS";
  const puckEvidenceState: EvidenceState = puckPass ? "PASS" : puckRead.state === "ABSENT" ? "ABSENT" : "FAIL";
  const payloadEvidenceState: EvidenceState = payloadPass ? "PASS" : payloadRead.state === "ABSENT" ? "ABSENT" : "FAIL";
  if (!puckPass) failures.push("predecessor:puck");
  if (!payloadPass) failures.push("predecessor:payload");
  const chainDigest: ControlState = payloadRead.value && puckDigest
    ? payloadRead.value.predecessor.path === puckRelative && payloadRead.value.predecessor.sha256 === puckDigest ? "PASS" : "FAIL"
    : puckRead.state === "ABSENT" || payloadRead.state === "ABSENT" ? "ABSENT" : "FAIL";
  if (chainDigest !== "PASS") failures.push("predecessor:chain-digest");
  let graphConsistency: ControlState = puckRead.value && payloadRead.value ? "PASS" : puckRead.state === "ABSENT" || payloadRead.state === "ABSENT" ? "ABSENT" : "FAIL";
  if (puckRead.value && payloadRead.value) {
    const puckGraphs = new Map(puckRead.value.graphs.map((graph) => [graph.category, graph]));
    const payloadGraphs = new Map(payloadRead.value.graphs.map((graph) => [graph.category, graph]));
    if (puckGraphs.size !== categories.length || payloadGraphs.size !== categories.length || categories.some((category) => {
      const puck = puckGraphs.get(category); const payload = payloadGraphs.get(category);
      return !puck || !payload || puck.fingerprint !== puck.publishedFingerprint || payload.fingerprint !== payload.declaredFingerprint
        || payload.fingerprint !== payload.restoredFingerprint || puck.fingerprint !== payload.fingerprint
        || !arraysEqual(puck.semanticOrder, puck.renderedSemanticOrder) || !arraysEqual(puck.semanticOrder, payload.semanticOrder);
    })) graphConsistency = "FAIL";
  }
  if (graphConsistency !== "PASS") failures.push("predecessor:graph-consistency");
  const predecessorState: EvidenceState = puckPass && payloadPass && chainDigest === "PASS" && graphConsistency === "PASS" ? "PASS" : puckRead.state === "ABSENT" || payloadRead.state === "ABSENT" ? "ABSENT" : "FAIL";

  const requestedCommandResults = process.env.WDC_ISSUE_35_COMMAND_RESULTS ?? process.argv[2] ?? "artifacts/handoff/issue-35-closure-command-results.json";
  const commandResultsRelative = isSafeRelativePath(requestedCommandResults) ? requestedCommandResults : "artifacts/handoff/issue-35-closure-command-results.json";
  const commandResultsPath = resolve(root, commandResultsRelative);
  const insideRoot = commandResultsPath === root || commandResultsPath.startsWith(`${root}${sep}`);
  let commandResultsBytes: Buffer | null = null;
  let commandResultsValue: unknown = null;
  if (!insideRoot) failures.push("command-results:path-outside-repository");
  else try {
    commandResultsBytes = await readFile(commandResultsPath);
    commandResultsValue = JSON.parse(commandResultsBytes.toString("utf8"));
  } catch (error) {
    failures.push(isRecord(error) && error.code === "ENOENT" ? "command-results:absent" : "command-results:invalid-json");
  }
  const commandEvaluation = evaluateCommandResults(commandResultsValue, gitSubject);
  failures.push(...commandEvaluation.failures);
  let commandEvidencePass = true;
  for (const command of commandEvaluation.commands) for (const evidence of command.evidence) {
    try {
      const bytes = await readFile(join(root, evidence.path));
      if (sha256(bytes) !== evidence.sha256) { commandEvidencePass = false; failures.push(`command-evidence:${command.command}:digest`); }
    } catch {
      commandEvidencePass = false;
      failures.push(`command-evidence:${command.command}:absent`);
    }
  }

  const browserRead = await readValidatedReceipt<GeneratedPageReceipt>(join(root, browserRelative), "generated-page-browser-receipt-v3.schema.json");
  const browserDigest = browserRead.bytes ? sha256(browserRead.bytes) : null;
  const browserLineage: ControlState = browserRead.value
    ? browserRead.value.git.sha === git.sha && browserRead.value.git.ref === git.ref ? "PASS" : "FAIL"
    : browserRead.state;
  const browserShapePass = browserRead.value?.overall === "PASS" && browserRead.value.expected.categories === 6 && browserRead.value.expected.projects === 3
    && browserRead.value.expected.screenshots === 18 && browserRead.value.expected.qualityObservations === 12
    && browserRead.value.observed.categories === 6 && browserRead.value.observed.projects === 3 && browserRead.value.observed.screenshots === 18
    && browserRead.value.observed.qualityObservations === 12 && browserRead.value.qualityEvidence.length === 12 && browserRead.value.missing.length === 0;
  const browserReceiptState: EvidenceState = browserRead.state === "PASS" && browserLineage === "PASS" && browserShapePass ? "PASS" : browserRead.state === "ABSENT" ? "ABSENT" : "FAIL";
  if (browserReceiptState !== "PASS") failures.push("browser:receipt");

  const expectedScreenshotKeys = new Set(categories.flatMap((category) => screenshotProjects.map((project) => `${project}/${category}`)));
  const seenScreenshotKeys = new Set<string>();
  const unexpected: string[] = [];
  const digestMismatches: string[] = [];
  const inventory: Array<{ category: string; project: string; path: string; declaredSha256: string; actualSha256: string | null; verdict: "PASS" | "FAIL" | "ABSENT" }> = [];
  for (const evidence of browserRead.value?.evidence ?? []) {
    const key = `${evidence.project}/${evidence.category}`;
    const expectedPath = `screenshots/${evidence.project}--${evidence.category}.png`;
    if (!expectedScreenshotKeys.has(key) || evidence.path !== expectedPath || seenScreenshotKeys.has(key)) unexpected.push(key);
    seenScreenshotKeys.add(key);
    let actualSha256: string | null = null;
    let verdict: "PASS" | "FAIL" | "ABSENT" = "ABSENT";
    try {
      actualSha256 = sha256(await readFile(join(root, "artifacts", "generated-pages", evidence.path)));
      verdict = actualSha256 === evidence.sha256 ? "PASS" : "FAIL";
      if (verdict === "FAIL") digestMismatches.push(key);
    } catch {
      // Absence is recorded without leaking an absolute machine path.
    }
    inventory.push({ category: evidence.category, project: evidence.project, path: `artifacts/generated-pages/${evidence.path}`, declaredSha256: evidence.sha256, actualSha256, verdict });
  }
  const missingScreenshots = [...expectedScreenshotKeys].filter((key) => !seenScreenshotKeys.has(key)).sort();
  const screenshotState: EvidenceState = browserRead.value && inventory.length === 18 && missingScreenshots.length === 0 && unexpected.length === 0
    && digestMismatches.length === 0 && inventory.every((entry) => entry.verdict === "PASS") ? "PASS" : browserRead.state === "ABSENT" ? "ABSENT" : "FAIL";
  if (screenshotState !== "PASS") failures.push("browser:screenshot-inventory");

  let reportBytes: Buffer | null = null; let report: unknown = null;
  try { reportBytes = await readFile(join(root, reportRelative)); report = JSON.parse(reportBytes.toString("utf8")); } catch { failures.push("browser:playwright-report"); }
  let sourceBytes: Buffer | null = null; let source: string | null = null;
  try { sourceBytes = await readFile(join(root, sourceRelative)); source = sourceBytes.toString("utf8"); } catch { failures.push("browser:generated-page-test-source"); }
  const runtimeAssertions = summarizeGeneratedPageReport(report, source);
  const reportDigest = reportBytes ? sha256(reportBytes) : null;
  const browserQa = commandEvaluation.commands.find((command) => command.command === "pnpm browser:qa");
  const reportBound = Boolean(reportDigest && browserQa?.evidence.some((entry) => entry.path === reportRelative && entry.sha256 === reportDigest));
  if (!reportBound) failures.push("browser:playwright-report-not-bound-to-command");
  if (runtimeAssertions.state !== "PASS") failures.push("browser:runtime-assertions");
  const finalRuntimeState: EvidenceState = runtimeAssertions.state === "PASS" && reportBound ? "PASS" : report === null ? "ABSENT" : "FAIL";

  const commandState: EvidenceState = commandResultsBytes && commandEvaluation.state === "PASS" && commandEvidencePass ? "PASS" : commandResultsBytes ? "FAIL" : "ABSENT";
  const allPass = failures.length === 0 && git.trackedWorktreeClean && predecessorState === "PASS" && commandState === "PASS"
    && browserReceiptState === "PASS" && screenshotState === "PASS" && finalRuntimeState === "PASS" && commandEvaluation.cleanup.state === "PASS";
  const receipt = {
    schema: "website-design-compiler/issue-35-local-closure/v1",
    overall: allPass ? "PASS" : "FAIL",
    git,
    predecessors: {
      state: predecessorState,
      puck: { path: puckRelative, sha256: puckDigest, state: puckEvidenceState, sameLineage: puckLineage },
      payload: { path: payloadRelative, sha256: payloadDigest, state: payloadEvidenceState, sameLineage: payloadLineage },
      chainDigest,
      graphConsistency
    },
    commandResults: { path: relative(root, commandResultsPath), sha256: commandResultsBytes ? sha256(commandResultsBytes) : null, state: commandState, sameLineage: commandEvaluation.sameLineage },
    commands: commandEvaluation.commands,
    browser: {
      receipt: { path: browserRelative, sha256: browserDigest, state: browserReceiptState, sameLineage: browserLineage },
      screenshots: { state: screenshotState, expected: 18, observed: inventory.length, distinctHashes: new Set(inventory.map((entry) => entry.actualSha256).filter(Boolean)).size, inventory, missing: missingScreenshots, unexpected: unexpected.sort(), digestMismatches: digestMismatches.sort() },
      runtimeAssertions: { ...runtimeAssertions, state: finalRuntimeState, reportPath: reportRelative, reportSha256: reportDigest, testSourcePath: sourceRelative, testSourceSha256: sourceBytes ? sha256(sourceBytes) : null }
    },
    cleanup: commandEvaluation.cleanup,
    residualNotExercised: commandEvaluation.residualNotExercised,
    failures: [...new Set(failures)].sort()
  };
  await validateAgainstSchema(receipt, "issue-35-local-closure.schema.json");
  await mkdir(handoffDirectory, { recursive: true });
  await writeFile(join(handoffDirectory, "issue-35-local-closure.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ overall: receipt.overall, failures: receipt.failures.length, output: "artifacts/handoff/issue-35-local-closure.json" }));
  if (!allPass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
