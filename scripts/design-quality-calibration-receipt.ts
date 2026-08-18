import { createHash } from "node:crypto";
import { mkdir,readFile,readdir,writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompletePageGraph } from "../src/complete-page-graph.js";
import { calibratedVisualSimilarity,orderedTokenSimilarity,pageGraphStructureSignature } from "../src/design-quality-calibration.js";
import type { DesignQualityBrowserObservation } from "../src/design-quality-observation.js";
import { validateAgainstSchema } from "../src/validate.js";

const sha256=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const v3Mode=process.env.DESIGN_QUALITY_CALIBRATION_VERSION==="v3";
const gitSha=process.env.GITHUB_SHA??"UNBOUND";
const gitRef=process.env.GITHUB_REF??"UNBOUND";
const threshold=.82;
const categories=["b2b-product","editorial","premium-consumer","motion-heavy","interactive-2d","interactive-3d"] as const;
const observationDirectory=join(process.cwd(),"artifacts","design-quality-browser");
const projectionPath=join(process.cwd(),"apps","site","generated","benchmark-page-graphs.json");
const projectionBytes=await readFile(projectionPath);
const projection=JSON.parse(projectionBytes.toString("utf8")) as {schema:string;source:string;graphs:Record<string,CompletePageGraph>};
if(projection.schema!=="website-design-compiler/site-page-graph-projection/v2"||projection.source!=="production-site-compiler")throw new Error("calibration requires the production site graph projection");
const graphs=categories.map((category)=>projection.graphs[category]).filter((graph):graph is CompletePageGraph=>Boolean(graph));
if(graphs.length!==categories.length||graphs.some((graph)=>graph.readiness!=="READY"||graph.source.mode!=="PRODUCTION"||graph.missingEvidence.length>0))throw new Error("calibration requires six READY production page graphs");

const observations:DesignQualityBrowserObservation[]=[];
const observationSources=[];
for(const name of (await readdir(observationDirectory)).filter((entry)=>entry.endsWith(".json")).sort()){
  const path=join(observationDirectory,name);const bytes=await readFile(path);
  const observation=await validateAgainstSchema<DesignQualityBrowserObservation>(JSON.parse(bytes.toString("utf8")),"design-quality-browser-observation.schema.json");
  if(!categories.includes(observation.category as typeof categories[number]))continue;
  const screenshotBytes=await readFile(join(process.cwd(),observation.screenshot.path));
  if(sha256(screenshotBytes)!==observation.screenshot.sha256)throw new Error(`${name}: screenshot digest mismatch`);
  observations.push(observation);
  observationSources.push({category:observation.category,viewport:observation.viewport,path:`artifacts/design-quality-browser/${name}`,sha256:sha256(bytes),screenshotSha256:observation.screenshot.sha256});
}
if(observations.length!==12||new Set(observations.map((entry)=>`${entry.category}:${entry.viewport}`)).size!==12)throw new Error("calibration requires exactly six categories across desktop and mobile");

const baseline=observations.find((entry)=>entry.viewport==="desktop")!;
const reordered=structuredClone(baseline);reordered.computed.layouts.reverse();reordered.computed.renderedColumns.reverse();reordered.computed.sectionHeights.reverse();reordered.computed.sectionWidths.reverse();
const paletteOnly=structuredClone(baseline);paletteOnly.computed.cssTokens["--wdc-color-background"]="oklch(0.92 0.04 120)";paletteOnly.computed.cssTokens["--wdc-color-surface"]="oklch(0.84 0.08 120)";paletteOnly.computed.cssTokens["--wdc-color-accent"]="oklch(0.38 0.18 140)";
const distant=structuredClone(baseline);distant.pixels={...distant.pixels,quantizedUniqueColors:5,luminanceMean:.98,luminanceStdDev:.01,luminanceSpan:.03,edgeContrastMean:.002,colorEntropy:.15,channels:{red:{mean:.98,stdDev:.01},green:{mean:.98,stdDev:.01},blue:{mean:.98,stdDev:.01}}};distant.computed.layouts=distant.computed.layouts.map(()=>"stack");distant.computed.renderedColumns=distant.computed.renderedColumns.map(()=>1);distant.computed.sectionWidths=distant.computed.sectionWidths.map(()=>distant.computed.pageWidth);distant.computed.mediaStages=0;
const controls={identical:calibratedVisualSimilarity(baseline,structuredClone(baseline)),reordered:calibratedVisualSimilarity(baseline,reordered),paletteOnly:calibratedVisualSimilarity(baseline,paletteOnly),distant:calibratedVisualSimilarity(baseline,distant)};
const controlsPass=controls.identical===1&&controls.reordered<.9&&controls.paletteOnly>.5&&controls.paletteOnly<1&&controls.distant<threshold;

const viewports=([] as Array<"desktop"|"mobile">).concat("desktop","mobile").map((viewport)=>{
  const cohort=observations.filter((entry)=>entry.viewport===viewport);const pairs=[];
  for(let first=0;first<cohort.length;first+=1)for(let second=first+1;second<cohort.length;second+=1)pairs.push({first:cohort[first]!.category,second:cohort[second]!.category,similarity:calibratedVisualSimilarity(cohort[first]!,cohort[second]!)});
  pairs.sort((left,right)=>right.similarity-left.similarity||left.first.localeCompare(right.first)||left.second.localeCompare(right.second));
  return{viewport,pairCount:pairs.length,maxSimilarity:pairs[0]?.similarity??1,nearestPair:pairs[0]??null,pairs};
});
const structures=graphs.map((graph)=>({category:graph.category,signature:pageGraphStructureSignature(graph)}));const structurePairs=[];
for(let first=0;first<structures.length;first+=1)for(let second=first+1;second<structures.length;second+=1)structurePairs.push({first:structures[first]!.category,second:structures[second]!.category,similarity:orderedTokenSimilarity(structures[first]!.signature.split("|"),structures[second]!.signature.split("|"))});
structurePairs.sort((left,right)=>right.similarity-left.similarity||left.first.localeCompare(right.first)||left.second.localeCompare(right.second));
const structure={pairCount:structurePairs.length,maxSimilarity:structurePairs[0]?.similarity??1,nearestPair:structurePairs[0]??null,pairs:structurePairs};
const corpusPass=viewports.every((entry)=>entry.pairCount===15&&entry.maxSimilarity<threshold)&&structure.pairCount===15&&structure.maxSimilarity<threshold;
const exactHeadBound=/^[a-f0-9]{40}$/.test(gitSha)&&observations.every((observation)=>observation.git.sha===gitSha);
const common={threshold,categoryCount:categories.length,observationCount:observations.length,controls:{state:controlsPass?"PASS":"FAIL",...controls},viewports,structure,sources:{projection:{path:"apps/site/generated/benchmark-page-graphs.json",sha256:sha256(projectionBytes)},observations:observationSources}};
const receipt=v3Mode?{schema:"website-design-compiler/design-quality-calibration-receipt/v2",overall:controlsPass&&corpusPass&&exactHeadBound?"PASS":"FAIL",git:{sha:gitSha,ref:gitRef},exactHeadBound,methods:{scoreModel:"runtime-evidence-weighted/v3",structuralSimilarity:"ordered-page-graph/v1",visualSimilarity:"calibrated-visual/v1"},...common}:{schema:"website-design-compiler/design-quality-calibration-receipt/v1",overall:controlsPass&&corpusPass?"PASS":"FAIL",...common};
await validateAgainstSchema(receipt,v3Mode?"design-quality-calibration-receipt-v2.schema.json":"design-quality-calibration-receipt.schema.json");
const outputDirectory=join(process.cwd(),"artifacts",v3Mode?"v3":"v2","design-quality-calibration");await mkdir(outputDirectory,{recursive:true});
const outputPath=join(outputDirectory,"design-quality-calibration-receipt.json");await writeFile(outputPath,`${JSON.stringify(receipt,null,2)}\n`,"utf8");
console.log(JSON.stringify({path:outputPath,overall:receipt.overall,...(v3Mode?{exactHeadBound}:{}),controls:receipt.controls,viewports:receipt.viewports.map((entry)=>({viewport:entry.viewport,maxSimilarity:entry.maxSimilarity,nearestPair:entry.nearestPair})),structure:{maxSimilarity:receipt.structure.maxSimilarity,nearestPair:receipt.structure.nearestPair}}));
if(receipt.overall!=="PASS")process.exitCode=1;
