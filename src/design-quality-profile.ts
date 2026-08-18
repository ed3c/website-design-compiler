interface DesignQualityReleaseProfileBase {
  id:string;
  premiumQualityThreshold:number;
  originalitySimilarityThreshold:number;
  requiredViewports:("mobile"|"desktop")[];
  requireExactEvidenceBinding:true;
}
export interface DesignQualityReleaseProfile extends DesignQualityReleaseProfileBase {
  schema:"website-design-compiler/design-quality-release-profile/v2";
}
export interface DesignQualityReleaseProfileV3 extends DesignQualityReleaseProfileBase {
  schema:"website-design-compiler/design-quality-release-profile/v3";
  evaluator:{
    schema:"website-design-compiler/design-quality-evaluator-config/v3";
    scoreModel:"runtime-evidence-weighted/v3";
    structuralSimilarity:"ordered-page-graph/v1";
    visualSimilarity:"calibrated-visual/v1";
  };
  calibrationReceipt:{
    path:"artifacts/v3/design-quality-calibration/design-quality-calibration-receipt.json";
    schema:"website-design-compiler/design-quality-calibration-receipt/v2";
  };
}
export type AnyDesignQualityReleaseProfile=DesignQualityReleaseProfile|DesignQualityReleaseProfileV3;

export function validateDesignQualityReleaseProfile(profile:AnyDesignQualityReleaseProfile):string[]{
  const errors:string[]=[];
  if(profile.schema!=="website-design-compiler/design-quality-release-profile/v2"&&profile.schema!=="website-design-compiler/design-quality-release-profile/v3")errors.push("unsupported release profile schema");
  if(!profile.id.trim())errors.push("release profile id is empty");
  if(!Number.isFinite(profile.premiumQualityThreshold)||profile.premiumQualityThreshold<0||profile.premiumQualityThreshold>100)errors.push("premium quality threshold must be between 0 and 100");
  if(!Number.isFinite(profile.originalitySimilarityThreshold)||profile.originalitySimilarityThreshold<=0||profile.originalitySimilarityThreshold>1)errors.push("originality similarity threshold must be in (0,1]");
  if(profile.requiredViewports.length!==2||!profile.requiredViewports.includes("mobile")||!profile.requiredViewports.includes("desktop"))errors.push("premium profile must require separate mobile and desktop evaluation");
  if(profile.requireExactEvidenceBinding!==true)errors.push("premium profile must require exact evidence binding");
  if(profile.schema==="website-design-compiler/design-quality-release-profile/v3"){
    if(profile.premiumQualityThreshold<78)errors.push("v3 premium quality threshold must be at least 78");
    if(profile.originalitySimilarityThreshold<.82)errors.push("v3 originality similarity threshold must be at least 0.82");
    if(!profile.evaluator||profile.evaluator.schema!=="website-design-compiler/design-quality-evaluator-config/v3")errors.push("v3 evaluator schema must be website-design-compiler/design-quality-evaluator-config/v3");
    if(!profile.evaluator||profile.evaluator.scoreModel!=="runtime-evidence-weighted/v3")errors.push("v3 score model must be runtime-evidence-weighted/v3");
    if(!profile.evaluator||profile.evaluator.structuralSimilarity!=="ordered-page-graph/v1")errors.push("v3 structural similarity must be ordered-page-graph/v1");
    if(!profile.evaluator||profile.evaluator.visualSimilarity!=="calibrated-visual/v1")errors.push("v3 visual similarity must be calibrated-visual/v1");
    if(!profile.calibrationReceipt||profile.calibrationReceipt.path!=="artifacts/v3/design-quality-calibration/design-quality-calibration-receipt.json"||profile.calibrationReceipt.schema!=="website-design-compiler/design-quality-calibration-receipt/v2")errors.push("v3 profile must bind the governed calibration receipt");
  }
  return errors;
}
