import type { DesignQualityScorecard, QualityViewport } from "./design-quality-eval.js";

export type EvidenceState = "BOUND" | "ABSENT" | "MISMATCH";
export interface DesignQualityEvidenceBinding {
  schema:"website-design-compiler/design-quality-evidence/v2";
  category:string;
  viewport:QualityViewport;
  pageGraphSha256:string;
  designTokensSha256:string;
  screenshotSha256:string;
  gitSha:string;
  graphSignature:string;
  screenshotPath:string;
}
export interface PremiumQualityDecision {
  schema:"website-design-compiler/premium-quality-decision/v2";
  category:string;
  viewport:QualityViewport;
  threshold:number;
  structuralScore:number;
  structuralState:"PASS"|"FAIL";
  evidenceState:"PASS"|"FAIL";
  overall:"PREMIUM_PASS"|"FAIL";
  bindings:{pageGraph:EvidenceState;designTokens:EvidenceState;screenshot:EvidenceState;gitSha:EvidenceState;graphSignature:EvidenceState};
  reasons:string[];
}
const SHA256=/^[a-f0-9]{64}$/;
const GIT_SHA=/^[a-f0-9]{40}$/;
function validPath(path:string):boolean{return path.length>0&&!path.startsWith("/")&&!path.includes("..")&&!path.includes("\\");}
export function validateDesignQualityEvidence(binding:DesignQualityEvidenceBinding,expected:{category:string;viewport:QualityViewport;graphSignature:string;gitSha:string}):PremiumQualityDecision["bindings"]{
  return{
    pageGraph:SHA256.test(binding.pageGraphSha256)?"BOUND":"ABSENT",
    designTokens:SHA256.test(binding.designTokensSha256)?"BOUND":"ABSENT",
    screenshot:SHA256.test(binding.screenshotSha256)&&validPath(binding.screenshotPath)?"BOUND":"ABSENT",
    gitSha:!GIT_SHA.test(binding.gitSha)?"ABSENT":binding.gitSha===expected.gitSha?"BOUND":"MISMATCH",
    graphSignature:binding.graphSignature===expected.graphSignature&&binding.category===expected.category&&binding.viewport===expected.viewport?"BOUND":"MISMATCH"
  };
}
export function decidePremiumQuality(card:DesignQualityScorecard,binding:DesignQualityEvidenceBinding|null,expectedGitSha:string,threshold=card.threshold):PremiumQualityDecision{
  const emptyBindings:PremiumQualityDecision["bindings"]={pageGraph:"ABSENT",designTokens:"ABSENT",screenshot:"ABSENT",gitSha:"ABSENT",graphSignature:"ABSENT"};
  const bindings=binding?validateDesignQualityEvidence(binding,{category:card.category,viewport:card.viewport,graphSignature:card.graphSignature,gitSha:expectedGitSha}):emptyBindings;
  const reasons:string[]=[];
  if(card.score<threshold)reasons.push(`structural-score-below-threshold:${card.score}<${threshold}`);
  for(const [name,state] of Object.entries(bindings))if(state!=="BOUND")reasons.push(`${name}:${state}`);
  const evidenceState=Object.values(bindings).every((state)=>state==="BOUND")?"PASS":"FAIL";
  const structuralState=card.score>=threshold?"PASS":"FAIL";
  return{schema:"website-design-compiler/premium-quality-decision/v2",category:card.category,viewport:card.viewport,threshold,structuralScore:card.score,structuralState,evidenceState,overall:structuralState==="PASS"&&evidenceState==="PASS"?"PREMIUM_PASS":"FAIL",bindings,reasons};
}
