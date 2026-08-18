import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadWaivers, scanRepositoryRights } from "../src/repository-rights-clearance.js";

const waivers = await loadWaivers(resolve("rights-waivers.json"));
const scanned = await scanRepositoryRights(process.cwd(), waivers);
const receipt = {...scanned,git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"}};
const directory = resolve("artifacts/rights-clearance");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "repository-rights-clearance.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
await writeFile(resolve(directory, "sbom.json"), `${JSON.stringify({ schema: "website-design-compiler/sbom/v2", generatedAt: receipt.generatedAt, subjects: receipt.subjects.map(({ id, kind, name, versionOrIdentity, licenseExpression, state, distributed }) => ({ id, kind, name, versionOrIdentity, licenseExpression, state, distributed })) }, null, 2)}\n`, "utf8");
const notices = receipt.subjects.filter((subject) => receipt.noticeSubjects.includes(subject.id)).map((subject) => `- ${subject.name}@${subject.versionOrIdentity}: ${subject.licenseExpression ?? "UNKNOWN"} — ${subject.evidence.join(" | ")}`);
await writeFile(resolve(directory, "NOTICE.md"), `# Third-party attribution inventory\n\nEngineering-generated attribution inventory; verify final legal notices before distribution.\n\n${notices.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ overall: receipt.overall, subjectCount: receipt.subjects.length, counts: receipt.counts, unresolved: receipt.unresolved.length, expiredWaivers: receipt.expiredWaivers.length }));
if (receipt.overall !== "PASS") process.exitCode = 1;
