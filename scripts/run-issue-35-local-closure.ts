import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { OWNING_CLOSURE_COMMANDS, type ClosureCommand } from "./issue-35-local-closure-receipt.js";

type GitSubject = { ref: string; sha: string; tree: string };
type EvidenceRef = { path: string; sha256: string };

const root = process.cwd();
const outputRelative = "artifacts/handoff/issue-35-closure-command-results.json";
const browserPort = Number(process.env.WDC_BROWSER_PORT ?? "3011");
if (!Number.isInteger(browserPort) || browserPort < 1024 || browserPort > 65535) {
  throw new Error("WDC_BROWSER_PORT must be an unprivileged TCP port");
}
const git: GitSubject = {
  ref: execFileSync("git", ["symbolic-ref", "--quiet", "HEAD"], { encoding: "utf8" }).trim(),
  sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim()
};
const environment = {
  ...process.env,
  GITHUB_REF: git.ref,
  GITHUB_SHA: git.sha,
  WDC_BROWSER_PORT: String(browserPort)
};
const evidenceByCommand: Partial<Record<(typeof OWNING_CLOSURE_COMMANDS)[number], string[]>> = {
  "pnpm v2:complete-page-graph": [
    "artifacts/v2/complete-page-graph-receipt.json",
    "artifacts/v2/page-graph-roundtrip/receipt.json",
    "apps/site/generated/benchmark-page-graphs.json"
  ],
  "pnpm authoring:receipt": ["artifacts/authoring/authoring-receipt.json"],
  "pnpm cms:fixture": ["artifacts/cms/payload-cms-receipt.json"],
  "pnpm browser:qa": [
    "artifacts/browser-qa/playwright-report.json",
    "artifacts/browser-qa/playwright-runtime-report.json",
    "artifacts/generated-pages/generated-page-browser-receipt.json"
  ],
  "pnpm browser:receipt": ["artifacts/browser-qa/browser-qa.json"]
};
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const exists = async (path: string) => {
  try { await access(path); return true; } catch { return false; }
};
const collectEvidence = async (paths: readonly string[]): Promise<EvidenceRef[]> => {
  const evidence: EvidenceRef[] = [];
  for (const path of paths) {
    try {
      evidence.push({ path, sha256: sha256(await readFile(join(root, path))) });
    } catch {
      // The closure producer treats a missing declared artifact as a failure.
    }
  }
  return evidence;
};
const portAvailable = () => new Promise<boolean>((resolve) => {
  const server = createServer();
  server.once("error", () => resolve(false));
  server.listen(browserPort, "127.0.0.1", () => server.close(() => resolve(true)));
});

const commands: ClosureCommand[] = [];
let stopped = false;
for (const command of OWNING_CLOSURE_COMMANDS) {
  if (stopped) {
    commands.push({ command, evidence: [], exitCode: null, verdict: "NOT_EXERCISED" });
    continue;
  }
  const script = command.slice("pnpm ".length);
  const result = spawnSync("pnpm", [script], { cwd: root, env: environment, stdio: "inherit" });
  let exitCode = result.status ?? 1;
  if (exitCode === 0 && command === "pnpm browser:qa") {
    const generatedReceipt = spawnSync("pnpm", ["generated-pages:receipt"], {
      cwd: root,
      env: environment,
      stdio: "inherit"
    });
    exitCode = generatedReceipt.status ?? 1;
  }
  const evidence = await collectEvidence(evidenceByCommand[command] ?? []);
  const verdict = exitCode === 0 ? "PASS" : "FAIL";
  commands.push({ command, evidence, exitCode, verdict });
  if (verdict === "FAIL") stopped = true;
}

const browserCommand = commands.find((command) => command.command === "pnpm browser:qa");
const cmsCommand = commands.find((command) => command.command === "pnpm cms:fixture");
const browserStopped = await portAvailable();
const payloadStopped = cmsCommand?.verdict === "PASS"
  && await exists(join(root, "artifacts", "cms", "payload.sqlite"))
  && !(await exists(join(root, "artifacts", "cms", "payload.sqlite-wal")))
  && !(await exists(join(root, "artifacts", "cms", "payload.sqlite-shm")));
const cleanupPass = browserStopped && payloadStopped && browserCommand?.verdict === "PASS";
const cleanup = {
  state: cleanupPass ? "PASS" : "FAIL",
  devServer: browserStopped ? "PASS" : "FAIL",
  playwright: browserStopped && browserCommand?.verdict === "PASS" ? "PASS" : "FAIL",
  payload: payloadStopped ? "PASS" : "FAIL",
  temporaryRuntimeState: cleanupPass ? "PASS" : "FAIL",
  retainedEvidence: [
    "artifacts/handoff/issue-35-puck-runtime.json",
    "artifacts/handoff/issue-35-payload-runtime.json",
    "artifacts/generated-pages/generated-page-browser-receipt.json"
  ]
};
const receipt = {
  schema: "website-design-compiler/issue-35-closure-command-results/v1",
  git,
  commands,
  cleanup,
  residualNotExercised: [{
    lane: "hosted-payload",
    state: "NOT_EXERCISED",
    reason: "Issue #35 admits the repository-local Payload/SQLite runtime; no hosted service is required."
  }]
};
await mkdir(join(root, "artifacts", "handoff"), { recursive: true });
await writeFile(join(root, outputRelative), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ cleanup: cleanup.state, output: outputRelative, stopped, verdicts: commands.map(({ command, verdict }) => ({ command, verdict })) }));
if (stopped || !cleanupPass) process.exitCode = 1;
