import { createHash } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect,test } from "@playwright/test";
import projection from "../../apps/site/generated/benchmark-page-graphs.json";

type ProofPage={signature:string;nodes:Array<{id:string;kind:string}>};
type ProofSite={project:string;signature:string;source:{mode:string;artifacts:Record<string,string>};routes:Array<{route:string;page:ProofPage}>};
type KernelEditProof={schema:string;subjectHeadSha:string;category:string;route:string;sourceManifestIdentitySha256:string;sourceObservationIdentitySha256:string;basePageDigest:string;patchIdentitySha256:string;patchReceiptIdentitySha256:string;resultPageDigest:string;editedHeadline:string;site:ProofSite};
const proof=projection.kernelEditProof as KernelEditProof;

test("browser binds the exact compiler-kernel edited page graph",async({page},testInfo)=>{
  if(testInfo.project.name==="reduced-motion-chromium")await page.emulateMedia({reducedMotion:"reduce"});
  const response=await page.goto(`/benchmarks/${proof.category}?route=${encodeURIComponent(proof.route)}&kernelEdit=1`,{waitUntil:"networkidle"});
  expect(response?.ok()).toBeTruthy();
  const root=page.locator(`[data-compiled-site='${proof.category}'][data-kernel-edit='true']`);
  await expect(root).toBeVisible();
  const editedRoute=proof.site.routes.find((entry)=>entry.route===proof.route)!;
  const attributes={
    siteProject:await root.getAttribute("data-site-project"),
    route:await root.getAttribute("data-site-route"),
    siteSignature:await root.getAttribute("data-site-signature"),
    pageSignature:await root.getAttribute("data-page-signature"),
    subjectHeadSha:await root.getAttribute("data-kernel-subject-head"),
    sourceManifestIdentitySha256:await root.getAttribute("data-kernel-source-manifest"),
    sourceObservationIdentitySha256:await root.getAttribute("data-kernel-source-observation"),
    basePageDigest:await root.getAttribute("data-kernel-base-digest"),
    patchIdentitySha256:await root.getAttribute("data-kernel-patch-identity"),
    patchReceiptIdentitySha256:await root.getAttribute("data-kernel-patch-receipt"),
    resultPageDigest:await root.getAttribute("data-kernel-result-digest"),
    upstreamMode:await root.getAttribute("data-upstream-mode"),
    upstreamArtifacts:JSON.parse(await root.getAttribute("data-upstream-artifacts")??"null") as unknown,
    nodeIds:await root.locator("[data-page-node]").evaluateAll((nodes)=>nodes.map((node)=>node.getAttribute("data-page-node")))
  };
  expect(attributes.siteProject).toBe(proof.site.project);
  expect(attributes.route).toBe(proof.route);
  expect(attributes.siteSignature).toBe(proof.site.signature);
  expect(attributes.pageSignature).toBe(editedRoute.page.signature);
  expect(attributes.subjectHeadSha).toBe(proof.subjectHeadSha);
  expect(attributes.sourceManifestIdentitySha256).toBe(proof.sourceManifestIdentitySha256);
  expect(attributes.sourceObservationIdentitySha256).toBe(proof.sourceObservationIdentitySha256);
  expect(attributes.basePageDigest).toBe(proof.basePageDigest);
  expect(attributes.patchIdentitySha256).toBe(proof.patchIdentitySha256);
  expect(attributes.patchReceiptIdentitySha256).toBe(proof.patchReceiptIdentitySha256);
  expect(attributes.resultPageDigest).toBe(proof.resultPageDigest);
  expect(attributes.upstreamMode).toBe("PRODUCTION");
  expect(attributes.upstreamArtifacts).toEqual(proof.site.source.artifacts);
  expect(attributes.nodeIds).toEqual(editedRoute.page.nodes.map((node)=>node.id));
  await expect(page.getByText(proof.editedHeadline,{exact:true})).toBeVisible();
  await expect(root.locator("main[data-generated-page]")).toHaveCount(1);
  const noHorizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
  expect(noHorizontalOverflow).toBe(true);
  const reducedMotion=await page.evaluate(()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  expect(reducedMotion).toBe(testInfo.project.name==="reduced-motion-chromium");

  const screenshot=await page.screenshot({fullPage:true});
  const screenshotSha256=createHash("sha256").update(screenshot).digest("hex");
  const screenshotDirectory=join(process.cwd(),"artifacts","browser-qa","screenshots");
  const evidenceDirectory=join(process.cwd(),"artifacts","browser-qa","kernel-edit-evidence");
  await mkdir(screenshotDirectory,{recursive:true});await mkdir(evidenceDirectory,{recursive:true});
  const screenshotName=`kernel-edit--${testInfo.project.name}.png`;
  await writeFile(join(screenshotDirectory,screenshotName),screenshot);
  const viewport=page.viewportSize();
  const observation={
    schema:"website-design-compiler/kernel-edited-page-browser-observation/v1",
    browserProject:testInfo.project.name,
    subjectHeadSha:proof.subjectHeadSha,
    category:proof.category,
    route:proof.route,
    siteSignature:proof.site.signature,
    pageSignature:editedRoute.page.signature,
    sourceManifestIdentitySha256:proof.sourceManifestIdentitySha256,
    sourceObservationIdentitySha256:proof.sourceObservationIdentitySha256,
    basePageDigest:proof.basePageDigest,
    patchIdentitySha256:proof.patchIdentitySha256,
    patchReceiptIdentitySha256:proof.patchReceiptIdentitySha256,
    resultPageDigest:proof.resultPageDigest,
    editedHeadlineObserved:true,
    semanticNodeIds:attributes.nodeIds,
    noHorizontalOverflow,
    reducedMotion,
    viewport,
    screenshotPath:`screenshots/${screenshotName}`,
    screenshotSha256
  };
  await writeFile(join(evidenceDirectory,`${testInfo.project.name}.json`),`${JSON.stringify(observation,null,2)}\n`,`utf8`);
});
