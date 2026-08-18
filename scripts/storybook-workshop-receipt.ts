import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { collectBrowserProjectResults } from "../src/browser-qa.js";
import { evaluateReviewedGoldenAdmission } from "./storybook-golden-promote.js";

const root=join(process.cwd(),"artifacts","storybook");
const uiDirectory=join(process.cwd(),"apps","site","components","ui");
const goldenPath=join(process.cwd(),"fixtures","storybook","visual-goldens.json");
const sectionProjectionPath=join(process.cwd(),"artifacts","v2","section-grammar","projections.json");
const requiredProjects=["storybook-desktop","storybook-mobile"];
const requiredStates=["Loading","Empty","Error","Success"];
const requiredButtonStories=["Primary","Secondary","Disabled"];
type SectionProjection={kind:string;storyId:string;variantStories:Array<{variant:string;storyId:string}>};
function isMissing(error:unknown):boolean{return(error as NodeJS.ErrnoException).code==="ENOENT";}
async function readJsonIfPresent(path:string):Promise<unknown|null>{try{return JSON.parse(await readFile(path,"utf8")) as unknown;}catch(error:unknown){if(isMissing(error))return null;throw error;}}
async function walk(directory:string):Promise<string[]>{try{const entries=await readdir(directory);const files:string[]=[];for(const entry of entries){const path=join(directory,entry);const info=await stat(path);if(info.isDirectory())files.push(...await walk(path));else files.push(path);}return files;}catch(error:unknown){if(isMissing(error))return[];throw error;}}
async function sha256(path:string):Promise<string>{return createHash("sha256").update(await readFile(path)).digest("hex");}
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
const report=await readJsonIfPresent(join(root,"playwright-report.json"));
const projectResults=collectBrowserProjectResults(report);const passedProjects=new Set(projectResults.filter((result)=>result.status==="passed").map((result)=>result.projectName));const failedProjects=projectResults.filter((result)=>result.status==="failed").map((result)=>result.projectName).sort();const missingProjects=requiredProjects.filter((project)=>!passedProjects.has(project));
const files=await walk(root);const screenshotPaths=files.filter((path)=>path.endsWith(".png")&&path.includes(`${join("storybook","screenshots")}`));const screenshots=screenshotPaths.map((path)=>basename(path)).sort();const screenshotSet=new Set(screenshots);const staticBuild=files.some((path)=>path.endsWith(join("static","index.html")));
const missingSectionScreenshots=sectionVariantStories.flatMap((story)=>requiredProjects.map((project)=>`${project}--${story.storyId}.png`)).filter((name)=>!screenshotSet.has(name));
const goldenValue=await readJsonIfPresent(goldenPath);
const goldenAdmission=goldenValue?await evaluateReviewedGoldenAdmission(goldenValue):null;
const reviewedGolden=goldenAdmission?.state==="PASS"?goldenAdmission:null;
const goldenAdmissionError=goldenAdmission?.state==="FAIL"?goldenAdmission.error:null;
if(goldenAdmissionError)console.error(`fixtures/storybook/visual-goldens.json: admission failed: ${goldenAdmissionError}`);
const goldenCandidate=reviewedGolden?.candidate??null;
const goldenReview=reviewedGolden?.review??null;
const embeddedCandidateSha256=reviewedGolden?createHash("sha256").update(reviewedGolden.manifest.candidateArtifact.document,"utf8").digest("hex"):null;
const goldenScreenshots=goldenCandidate?.screenshots??{};
const goldenSource=goldenCandidate?.source??null;
const goldenReviewPass=reviewedGolden!==null;
const actualHashes:Record<string,string>={};for(const path of screenshotPaths)actualHashes[basename(path)]=await sha256(path);const expectedNames=Object.keys(goldenScreenshots).sort();const actualNames=Object.keys(actualHashes).sort();const missingGoldenScreenshots=expectedNames.filter((name)=>!(name in actualHashes));const unexpectedScreenshots=actualNames.filter((name)=>!expectedNames.includes(name));const visualMismatches=expectedNames.filter((name)=>name in actualHashes&&actualHashes[name]!==goldenScreenshots[name]).map((name)=>({name,expected:goldenScreenshots[name]??null,actual:actualHashes[name]??null}));const visualRegressionPass=reviewedGolden!==null&&missingGoldenScreenshots.length===0&&unexpectedScreenshots.length===0&&visualMismatches.length===0;
const gates={publicComponentCoverage:missingStories.length===0?"PASS":"FAIL",statusStateMatrix:missingStatusStates.length===0?"PASS":"FAIL",buttonStateMatrix:missingButtonStates.length===0?"PASS":"FAIL",richSectionRuntimeCoverage:sectionVariantStories.length===38&&new Set(sectionVariantStories.map((story)=>story.storyId)).size===38&&missingSectionScreenshots.length===0?"PASS":"FAIL",storybookBuild:staticBuild?"PASS":"FAIL",browserProjects:missingProjects.length===0&&failedProjects.length===0?"PASS":"FAIL",goldenEnvironmentBound:reviewedGolden!==null?"PASS":"FAIL",goldenReviewBound:goldenReviewPass?"PASS":"FAIL",visualRegression:visualRegressionPass?"PASS":"FAIL"} as const;
const overall=Object.values(gates).every((state)=>state==="PASS")?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/storybook-workshop-receipt/v1",overall,git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"},publicComponents,storyComponents,missingStories,requiredStates,missingStatusStates,requiredButtonStories,missingButtonStates,requiredProjects,projectResults,failedProjects,missingProjects,richSections:{expectedCount:sectionVariantStories.length,storyIds:sectionVariantStories.map((entry)=>entry.storyId),variants:sectionVariantStories,missingSectionScreenshots},screenshots,visualRegression:visualRegressionPass?"PASS":"FAIL",visualGoldens:reviewedGolden?{schema:reviewedGolden.manifest.schema,source:goldenSource,review:goldenReview,embeddedCandidateSha256,reviewBound:goldenReviewPass,expectedCount:expectedNames.length,actualCount:actualNames.length,missingGoldenScreenshots,unexpectedScreenshots,mismatches:visualMismatches,actualHashes}:null,goldenAdmissionError,gates};
const receiptPath=join(root,"storybook-workshop.json");await writeFile(receiptPath,`${JSON.stringify(receipt,null,2)}\n`,"utf8");console.log(JSON.stringify({receiptPath,overall,missingStories,missingProjects,missingSectionScreenshots,visualRegression:receipt.visualRegression,visualMismatches}));if(overall!=="PASS")process.exitCode=1;
