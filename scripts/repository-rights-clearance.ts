import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scanRepositoryRights, type Waiver } from "../src/repository-rights-clearance.js";

let waivers: Waiver[] = [];
try { waivers = JSON.parse(await readFile(resolve("rights-waivers.json"), "utf8")) as Waiver[]; } catch { /* no waivers */ }
const receipt = await scanRepositoryRights(process.cwd(), waivers);
const directory = resolve("artifacts/rights-clearance");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "repository-rights-clearance.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
await writeFile(resolve(directory, "sbom.json"), `${JSON.stringify({ schema: "website-design-compiler/sbom/v2", generatedAt: receipt.generatedAt, subjects: receipt.subjects.map(({ id, kind, name, versionOrIdentity, licenseExpression, state, distributed }) => ({ id, kind, name, versionOrIdentity, licenseExpression, state, distributed })) }, null, 2)}\n`, "utf8");
const notices = receipt.subjects.filter((subject) => receipt.noticeSubjects.includes(subject.id)).map((subject) => `- ${subject.name}@${subject.versionOrIdentity}: ${subject.licenseExpression ?? "UNKNOWN"} — ${subject.evidence.join(" | ")}`);
await writeFile(resolve(directory, "NOTICE.md"), `# Third-party attribution inventory\n\nEngineering-generated attribution inventory; verify final legal notices before distribution.\n\n${notices.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ overall: receipt.overall, subjectCount: receipt.subjects.length, counts: receipt.counts, unresolved: receipt.unresolved.length, expiredWaivers: receipt.expiredWaivers.length }));
if (receipt.overall !== "PASS") process.exitCode = 1;
