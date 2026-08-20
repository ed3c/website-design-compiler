import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { promisify } from "node:util";
import { collectBrowserProjectResults } from "../src/browser-qa.js";
import { evaluateReviewedGoldenAdmission } from "./storybook-golden-promote.js";

const root=join(process.cwd(),"artifacts","storybook");
const uiDirectory=join(process.cwd(),"apps","site","components","ui");
const goldenPath=join(process.cwd(),"fixtures","storybook","visual-goldens.json");
const sectionProjectionPath=join(process.cwd(),"artifacts","v2","section-grammar","projections.json");
const requiredProjects=["storybook-desktop","storybook-mobile"];
const requiredStates=["Loading","Empty","Error","Success"];
const requiredButtonStories=["Primary","Secondary","Disabled"];
const execFileAsync=promisify(execFile);
const reviewedSourceRoots=[".github/workflows/compiler-core.yml","package.json","pnpm-lock.yaml","pnpm-workspace.yaml","apps/site/app","apps/site/components","apps/site/.storybook","fixtures/showcase","schemas/storybook-golden-candidate.schema.json","schemas/storybook-golden-review.schema.json","schemas/storybook-visual-goldens.schema.json","scripts/storybook-golden-candidate.ts","scripts/storybook-golden-promote.ts","scripts/storybook-workshop-receipt.ts","src/semantic-design-tokens.ts","src/validate.ts","tests/storybook","playwright.storybook.config.ts","tsconfig.storybook.json"];
type SectionProjection={kind:string;storyId:string;variantStories:Array<{variant:string;storyId:string}>};
function isMissing(error:unknown):boolean{return(error as NodeJS.ErrnoException).code==="ENOENT";}
async function readJsonIfPresent(path:string):Promise<unknown|null>{try{return JSON.parse(await readFile(path,"utf8")) as unknown;}catch(error:unknown){if(isMissing(error))return null;throw error;}}
async function walk(directory:string):Promise<string[]>{try{const entries=await readdir(directory);const files:string[]=[];for(const entry of entries){const path=join(directory,entry);const info=await stat(path);if(info.isDirectory())files.push(...await walk(path));else files.push(path);}return files;}catch(error:unknown){if(isMissing(error))return[];throw error;}}
async function sha256(path:string):Promise<string>{return createHash("sha256").update(await readFile(path)).digest("hex");}
async function collectReviewedSources():Promise<{files:string[];diagnostics:string[];sha256:string}>{
  const files:string[]=[];const diagnostics:string[]=[];
  for(const rootPath of reviewedSourceRoots){
    const path=join(process.cwd(),rootPath);
    try{const info=await stat(path);if(info.isDirectory())files.push(...await walk(path));else if(info.isFile())files.push(path);else diagnostics.push(`${rootPath}: reviewed source is neither a file nor directory`);}
    catch(error:unknown){diagnostics.push(`${rootPath}: reviewed source is unreadable (${(error as NodeJS.ErrnoException).code??"UNKNOWN"})`);}
  }
  files.sort();const digest=createHash("sha256");
  for(const path of files){digest.update(relative(process.cwd(),path).replaceAll("\\","/"));digest.update("\0");digest.update(await readFile(path));digest.update("\0");}
  return{files,diagnostics,sha256:digest.digest("hex")};
}
await mkdir(root,{recursive:true});
const uiEntries=await readdir(uiDirectory);
const publicComponents=uiEntries.filter((name)=>name.endsWith(".tsx")&&!name.endsWith(".stories.tsx")).map((name)=>name.replace(/\.tsx$/,"" )).sort();
const storyComponents=uiEntries.filter((name)=>name.endsWith(".stories.tsx")).map((name)=>name.replace(/\.stories\.tsx$/,"" )).sort();
const missingStories=publicComponents.filter((component)=>!storyComponents.includes(component));
const statusStorySource=await readFile(join(uiDirectory,"status-panel.stories.tsx"),"utf8");
const buttonStorySource=await readFile(join(uiDirectory,"button.stories.tsx"),"utf8");
const missingStatusStates=requiredStates.filter((name)=>!statusStorySource.includes(`export const ${name}:`));
const missingButtonStates=requiredButtonStories.filter((name)=>!buttonStorySource.includes(`export const ${name}:`));
const sectionProjectionValue=await readJsonIfPresent(sectionProjectionPath);
const sectionProjections=Array.isArray(sectionProjectionValue)&&sectionProjectionValue.every((entry)=>entry&&typeof entry==="object"&&typeof (entry as SectionProjection).kind==="string"&&typeof (entry as SectionProjection).storyId==="string"&&Array.isArray((entry as SectionProjection).variantStories))?sectionProjectionValue as SectionProjection[]:[];
const sectionVariantStories=sectionProjections.flatMap((projection)=>projection.variantStories.map((story)=>({kind:projection.kind,...story})));
const reviewedSources=await collectReviewedSources();
const report=await readJsonIfPresent(join(root,"playwright-report.json"));
const projectResults=collectBrowserProjectResults(report);const passedProjects=new Set(projectResults.filter((result)=>result.status==="passed").map((result)=>result.projectName));const failedProjects=projectResults.filter((result)=>result.status==="failed").map((result)=>result.projectName).sort();const missingProjects=requiredProjects.filter((project)=>!passedProjects.has(project));
const files=await walk(root);const screenshotPaths=files.filter((path)=>path.endsWith(".png")&&path.includes(`${join("storybook","screenshots")}`));const screenshots=screenshotPaths.map((path)=>basename(path)).sort();const screenshotSet=new Set(screenshots);const duplicateScreenshotNames=[...new Set(screenshots.filter((name,index)=>screenshots.indexOf(name)!==index))].sort();const staticBuild=files.some((path)=>path.endsWith(join("static","index.html")));
const missingSectionScreenshots=sectionVariantStories.flatMap((story)=>requiredProjects.map((project)=>`${project}--${story.storyId}.png`)).filter((name)=>!screenshotSet.has(name));
const goldenValue=await readJsonIfPresent(goldenPath);
const goldenAdmission=goldenValue?await evaluateReviewedGoldenAdmission(goldenValue):null;
const goldenManifestSha256=goldenValue?await sha256(goldenPath):null;
const trustedGoldenManifestSha256=process.env.WDC_STORYBOOK_VISUAL_GOLDENS_SHA256??null;
const trustDiagnostics:string[]=[];
if(!trustedGoldenManifestSha256)trustDiagnostics.push("trusted Storybook visual-goldens SHA-256 is absent");
else if(goldenManifestSha256!==trustedGoldenManifestSha256)trustDiagnostics.push("Storybook visual-goldens manifest does not match the externally trusted SHA-256");
let reviewSubjectIsAncestor=false;
if(goldenAdmission?.state==="PASS"){
  const candidateSha=goldenAdmission.candidate.source.git.sha;
  try{
    await execFileAsync("git",["merge-base","--is-ancestor",candidateSha,"HEAD"],{cwd:process.cwd()});
    reviewSubjectIsAncestor=true;
  }catch(error){trustDiagnostics.push(`reviewed Storybook subject is not an ancestor of the current UI: ${error instanceof Error?error.message:String(error)}`);}
  if(reviewSubjectIsAncestor)try{await execFileAsync("git",["diff","--quiet",candidateSha,"HEAD","--",...reviewedSourceRoots],{cwd:process.cwd()});}catch(error){trustDiagnostics.push(`reviewed Storybook source does not cover the current UI subject: ${error instanceof Error?error.message:String(error)}`);}
  const observations=goldenAdmission.review.inspectedScreenshots.map((entry)=>entry.observation.trim());
  if(new Set(observations).size!==observations.length)trustDiagnostics.push("Storybook review contains duplicated observations instead of screenshot-specific evidence");
  if(observations.some((observation)=>/\b(?:placeholder observation|looks? (?:fine|good)|observation number|lorem ipsum)\b|x{6,}/i.test(observation)))trustDiagnostics.push("Storybook review contains placeholder observations");
}
const reviewedGolden=goldenAdmission?.state==="PASS"&&trustDiagnostics.length===0?goldenAdmission:null;
const goldenAdmissionError=goldenAdmission?.state==="FAIL"?goldenAdmission.error:trustDiagnostics.length>0?trustDiagnostics.join("; "):null;
if(goldenAdmissionError)console.error(`fixtures/storybook/visual-goldens.json: admission failed: ${goldenAdmissionError}`);
const goldenCandidate=reviewedGolden?.candidate??null;
const goldenReview=reviewedGolden?.review??null;
const embeddedCandidateSha256=reviewedGolden?createHash("sha256").update(reviewedGolden.manifest.candidateArtifact.document,"utf8").digest("hex"):null;
const goldenScreenshots=goldenCandidate?.screenshots??{};
const goldenSource=goldenCandidate?.source??null;
const goldenReviewPass=reviewedGolden!==null;
const actualHashes:Record<string,string>={};for(const path of screenshotPaths)actualHashes[basename(path)]=await sha256(path);const expectedNames=Object.keys(goldenScreenshots).sort();const actualNames=Object.keys(actualHashes).sort();const missingGoldenScreenshots=expectedNames.filter((name)=>!(name in actualHashes));const unexpectedScreenshots=actualNames.filter((name)=>!expectedNames.includes(name));const visualMismatches=expectedNames.filter((name)=>name in actualHashes&&actualHashes[name]!==goldenScreenshots[name]).map((name)=>({name,expected:goldenScreenshots[name]??null,actual:actualHashes[name]??null}));const visualRegressionPass=reviewedGolden!==null&&missingGoldenScreenshots.length===0&&unexpectedScreenshots.length===0&&visualMismatches.length===0;
const screenshotSetSha256=createHash("sha256").update(JSON.stringify(Object.entries(actualHashes).sort(([left],[right])=>left.localeCompare(right)))).digest("hex");
const reviewDiagnostics=goldenAdmissionError?[goldenAdmissionError]:[];
const visualReview={reviewReceiptSha256:goldenReview?createHash("sha256").update(JSON.stringify(goldenReview)).digest("hex"):null,reviewSubjectIsAncestor,independentReviewDiagnostics:reviewDiagnostics,missingVisualReviews:[],unexpectedVisualReviews:[],duplicateVisualReviews:[],failedVisualReviews:[]};
const visualGoldens={schema:reviewedGolden?.manifest.schema??null,source:goldenSource,review:goldenReview,embeddedCandidateSha256,manifestSha256:goldenManifestSha256,externallyTrustedSha256:trustedGoldenManifestSha256,reviewedSourceRoots,reviewBound:goldenReviewPass,expectedCount:expectedNames.length,actualCount:actualNames.length,missingGoldenScreenshots,unexpectedScreenshots,mismatches:visualMismatches,actualHashes,admissionError:goldenAdmissionError};
const diagnostics=[...reviewedSources.diagnostics,...(sectionVariantStories.length===38?[]:[`expected 38 rich-section variants, observed ${sectionVariantStories.length}`]),...duplicateScreenshotNames.map((name)=>`duplicate screenshot name: ${name}`),...reviewDiagnostics];
const gates={inputDiagnostics:diagnostics.length===0?"PASS":"FAIL",publicComponentCoverage:missingStories.length===0?"PASS":"FAIL",statusStateMatrix:missingStatusStates.length===0?"PASS":"FAIL",buttonStateMatrix:missingButtonStates.length===0?"PASS":"FAIL",richSectionRuntimeCoverage:sectionVariantStories.length===38&&new Set(sectionVariantStories.map((story)=>story.storyId)).size===38&&missingSectionScreenshots.length===0?"PASS":"FAIL",storybookBuild:staticBuild?"PASS":"FAIL",browserProjects:missingProjects.length===0&&failedProjects.length===0?"PASS":"FAIL",visualReview:goldenReviewPass&&reviewDiagnostics.length===0?"PASS":"FAIL",visualRegression:visualRegressionPass?"PASS":"FAIL"} as const;
const overall=Object.values(gates).every((state)=>state==="PASS")?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/storybook-workshop-receipt/v1",overall,git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"},publicComponents,storyComponents,missingStories,requiredStates,missingStatusStates,requiredButtonStories,missingButtonStates,requiredProjects,projectResults,failedProjects,missingProjects,screenshots,duplicateScreenshotNames,reviewedSourceRoots,sourceFilesSha256:reviewedSources.sha256,screenshotSetSha256,diagnostics,richSections:{expectedCount:sectionVariantStories.length,storyIds:sectionVariantStories.map((entry)=>entry.storyId),variants:sectionVariantStories,missingSectionScreenshots},visualRegression:visualRegressionPass?"PASS":"FAIL",visualReview,visualGoldens,goldenAdmissionError,gates};
const receiptPath=join(root,"storybook-workshop.json");await writeFile(receiptPath,`${JSON.stringify(receipt,null,2)}\n`,"utf8");console.log(JSON.stringify({receiptPath,overall,missingStories,missingProjects,missingSectionScreenshots,visualRegression:receipt.visualRegression,visualMismatches}));if(overall!=="PASS")process.exitCode=1;
