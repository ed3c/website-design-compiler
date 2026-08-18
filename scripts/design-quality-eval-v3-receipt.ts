process.env.DESIGN_QUALITY_EVALUATOR_VERSION="v3";
try{
  await import("./design-quality-eval-receipt.js");
}catch(error){
  const {mkdir,writeFile}=await import("node:fs/promises");
  const {resolve}=await import("node:path");
  const outputDirectory=resolve("artifacts/v3/design-quality");
  await mkdir(outputDirectory,{recursive:true});
  const message=(error instanceof Error?error.message:String(error)).replaceAll(process.cwd(),"[workspace]");
  const receipt={schema:"website-design-compiler/design-quality-eval-receipt/v3",overall:"FAIL",git:{sha:process.env.GITHUB_SHA??"UNBOUND",ref:process.env.GITHUB_REF??"UNBOUND"},diagnostics:[message]};
  await writeFile(resolve(outputDirectory,"design-quality-eval-receipt.json"),`${JSON.stringify(receipt,null,2)}\n`,"utf8");
  console.error(JSON.stringify({overall:"FAIL",diagnostics:receipt.diagnostics}));
  process.exitCode=1;
}
