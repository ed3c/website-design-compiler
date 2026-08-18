export interface DesignQualityReleaseProfile {
  schema:"website-design-compiler/design-quality-release-profile/v2";
  id:string;
  premiumQualityThreshold:number;
  originalitySimilarityThreshold:number;
  requiredViewports:("mobile"|"desktop")[];
  requireExactEvidenceBinding:true;
}

export function validateDesignQualityReleaseProfile(profile:DesignQualityReleaseProfile):string[]{
  const errors:string[]=[];
  if(profile.schema!=="website-design-compiler/design-quality-release-profile/v2")errors.push("unsupported release profile schema");
  if(!profile.id.trim())errors.push("release profile id is empty");
  if(!Number.isFinite(profile.premiumQualityThreshold)||profile.premiumQualityThreshold<0||profile.premiumQualityThreshold>100)errors.push("premium quality threshold must be between 0 and 100");
  if(!Number.isFinite(profile.originalitySimilarityThreshold)||profile.originalitySimilarityThreshold<=0||profile.originalitySimilarityThreshold>1)errors.push("originality similarity threshold must be in (0,1]");
  if(profile.requiredViewports.length!==2||!profile.requiredViewports.includes("mobile")||!profile.requiredViewports.includes("desktop"))errors.push("premium profile must require separate mobile and desktop evaluation");
  if(profile.requireExactEvidenceBinding!==true)errors.push("premium profile must require exact evidence binding");
  return errors;
}
