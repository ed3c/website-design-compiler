import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { collectBrowserProjectResults } from "../src/browser-qa.js";

const root=join(process.cwd(),"artifacts","storybook");
const uiDirectory=join(process.cwd(),"apps","site","components","ui");
const goldenPath=join(process.cwd(),"fixtures","storybook","visual-goldens.json");
const sectionProjectionPath=join(process.cwd(),"artifacts","v2","section-grammar","projections.json");
const requiredProjects=["storybook-desktop","storybook-mobile"];
const requiredStates=["Loading","Empty","Error","Success"];
const requiredButtonStories=["Primary","Secondary","Disabled"];
type GoldenManifest={schema:"website-design-compiler/storybook-visual-goldens/v1";source:{gitSha:string;workflowRun:number;artifactId:number;browser:string;projects:string[]};screenshots:Record<string,string>};
type SectionProjection={kind:string;storyId:string};
async function walk(directory:string):Promise<string[]>{try{const entries=await readdir(directory);const files:string[]=[];for(const entry of entries){const path=join(directory,entry);const info=await stat(path);if(info.isDirectory())files.push(...await walk(path));else files.push(path);}return files;}catch{return [];}}
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
let sectionProjections:SectionProjection[]=[];try{sectionProjections=JSON.parse(await readFile(sectionProjectionPath,"utf8")) as SectionProjection[];}catch{}
let report:unknown=null;try{report=JSON.parse(await readFile(join(root,"playwright-report.json"),"utf8")) as unknown;}catch{}
const projectResults=collectBrowserProjectResults(report);const passedProjects=new Set(projectResults.filter((result)=>result.status==="passed").map((result)=>result.projectName));const failedProjects=projectResults.filter((result)=>result.status==="failed").map((result)=>result.projectName).sort();const missingProjects=requiredProjects.filter((project)=>!passedProjects.has(project));
const files=await walk(root);const screenshotPaths=files.filter((path)=>path.endsWith(".png")&&path.includes(`${join("storybook","screenshots")}`));const screenshots=screenshotPaths.map((path)=>basename(path)).sort();const screenshotSet=new Set(screenshots);const staticBuild=files.some((path)=>path.endsWith(join("static","index.html")));
const missingSectionScreenshots=sectionProjections.flatMap((projection)=>requiredProjects.map((project)=>`${project}--${projection.storyId}.png`)).filter((name)=>!screenshotSet.has(name));
let golden:GoldenManifest|null=null;try{const parsed=JSON.parse(await readFile(goldenPath,"utf8")) as GoldenManifest;if(parsed.schema==="website-design-compiler/storybook-visual-goldens/v1")golden=parsed;}catch{}
const actualHashes:Record<string,string>={};for(const path of screenshotPaths)actualHashes[basename(path)]=await sha256(path);const expectedNames=Object.keys(golden?.screenshots??{}).sort();const actualNames=Object.keys(actualHashes).sort();const missingGoldenScreenshots=expectedNames.filter((name)=>!(name in actualHashes));const unexpectedScreenshots=actualNames.filter((name)=>!expectedNames.includes(name));const visualMismatches=expectedNames.filter((name)=>name in actualHashes&&actualHashes[name]!==golden?.screenshots[name]).map((name)=>({name,expected:golden?.screenshots[name]??null,actual:actualHashes[name]??null}));const visualRegressionPass=golden!==null&&missingGoldenScreenshots.length===0&&unexpectedScreenshots.length===0&&visualMismatches.length===0;
const gates={publicComponentCoverage:missingStories.length===0?"PASS":"FAIL",statusStateMatrix:missingStatusStates.length===0?"PASS":"FAIL",buttonStateMatrix:missingButtonStates.length===0?"PASS":"FAIL",richSectionRuntimeCoverage:sectionProjections.length===18&&missingSectionScreenshots.length===0?"PASS":"FAIL",storybookBuild:staticBuild?"PASS":"FAIL",browserProjects:missingProjects.length===0&&failedProjects.length===0?"PASS":"FAIL",visualRegression:visualRegressionPass?"PASS":"FAIL"} as const;
const overall=Object.values(gates).every((state)=>state==="PASS")?"PASS":"FAIL";
const receipt={schema:"website-design-compiler/storybook-workshop-receipt/v1",overall,git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"},publicComponents,storyComponents,missingStories,requiredStates,missingStatusStates,requiredButtonStories,missingButtonStates,requiredProjects,projectResults,failedProjects,missingProjects,richSections:{expectedCount:sectionProjections.length,storyIds:sectionProjections.map((entry)=>entry.storyId),missingSectionScreenshots},screenshots,visualRegression:visualRegressionPass?"PASS":"FAIL",visualGoldens:golden?{schema:golden.schema,source:golden.source,expectedCount:expectedNames.length,actualCount:actualNames.length,missingGoldenScreenshots,unexpectedScreenshots,mismatches:visualMismatches,actualHashes}:null,gates};
const receiptPath=join(root,"storybook-workshop.json");await writeFile(receiptPath,`${JSON.stringify(receipt,null,2)}\n`,"utf8");console.log(JSON.stringify({receiptPath,overall,missingStories,missingProjects,missingSectionScreenshots,visualRegression:receipt.visualRegression,visualMismatches}));if(overall!=="PASS")process.exitCode=1;
