import type { DesignQualityScorecard, QualityViewport } from "./design-quality-eval.js";

export type EvidenceState="BOUND"|"ABSENT"|"MISMATCH";
export interface DesignQualityEvidenceBinding{
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
export interface ExpectedDesignQualityEvidence{
  category:string;
  viewport:QualityViewport;
  pageGraphSha256:string;
  designTokensSha256:string;
  screenshotSha256:string;
  gitSha:string;
  graphSignature:string;
}
export interface PremiumQualityDecision{
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
function compareHash(actual:string,expected:string):EvidenceState{return !SHA256.test(actual)?"ABSENT":actual===expected?"BOUND":"MISMATCH";}
export function validateDesignQualityEvidence(binding:DesignQualityEvidenceBinding,expected:ExpectedDesignQualityEvidence):PremiumQualityDecision["bindings"]{
  return{
    pageGraph:compareHash(binding.pageGraphSha256,expected.pageGraphSha256),
    designTokens:compareHash(binding.designTokensSha256,expected.designTokensSha256),
    screenshot:!validPath(binding.screenshotPath)||!SHA256.test(binding.screenshotSha256)?"ABSENT":binding.screenshotSha256===expected.screenshotSha256?"BOUND":"MISMATCH",
    gitSha:!GIT_SHA.test(binding.gitSha)?"ABSENT":binding.gitSha===expected.gitSha?"BOUND":"MISMATCH",
    graphSignature:binding.graphSignature===expected.graphSignature&&binding.category===expected.category&&binding.viewport===expected.viewport?"BOUND":"MISMATCH"
  };
}
export function decidePremiumQuality(card:DesignQualityScorecard,binding:DesignQualityEvidenceBinding|null,expected:ExpectedDesignQualityEvidence,threshold=card.threshold):PremiumQualityDecision{
  const emptyBindings:PremiumQualityDecision["bindings"]={pageGraph:"ABSENT",designTokens:"ABSENT",screenshot:"ABSENT",gitSha:"ABSENT",graphSignature:"ABSENT"};
  const bindings=binding?validateDesignQualityEvidence(binding,expected):emptyBindings;
  const reasons:string[]=[];
  if(card.score<threshold)reasons.push(`structural-score-below-threshold:${card.score}<${threshold}`);
  if(card.visualEvidenceState!=="PASS")reasons.push(`visual-evidence:${card.visualEvidenceState}`);
  if(card.originalityAudit.state!=="PASS")reasons.push("originality-audit:FAIL");
  for(const [name,state] of Object.entries(bindings))if(state!=="BOUND")reasons.push(`${name}:${state}`);
  const evidenceState=Object.values(bindings).every((state)=>state==="BOUND")?"PASS":"FAIL";
  const structuralState=card.score>=threshold&&card.visualEvidenceState==="PASS"&&card.originalityAudit.state==="PASS"?"PASS":"FAIL";
  return{schema:"website-design-compiler/premium-quality-decision/v2",category:card.category,viewport:card.viewport,threshold,structuralScore:card.score,structuralState,evidenceState,overall:structuralState==="PASS"&&evidenceState==="PASS"?"PREMIUM_PASS":"FAIL",bindings,reasons};
}
