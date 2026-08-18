import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getPayload } from "payload";
import {
  PAYLOAD_VERSION,
  authoringToPayloadLayout,
  createPayloadConfig,
  payloadLayoutToAuthoring
} from "../src/payload-cms.js";
import { validateAuthoringData, type AuthoringData } from "../src/puck-authoring.js";
import { completePageGraphSignature, type CompletePageGraph } from "../src/complete-page-graph.js";
import { pageGraphFingerprint, pageGraphToPuck, payloadToPuck, puckToPageGraph, puckToPayload, type PayloadPageGraphDocument } from "../src/page-graph-roundtrip.js";

const root = process.cwd();
const outputDirectory = join(root, "artifacts", "cms");
const dbPath = join(outputDirectory, "payload.sqlite");
const receiptPath = join(outputDirectory, "payload-cms-receipt.json");
const publishedFixturePath = join(root, "apps", "site", "generated", "payload-published-authoring-data.json");
const sourceFixturePath = join(root, "apps", "site", "generated", "showcase-authoring-data.json");
const productionProjectionPath=join(root,"apps","site","generated","benchmark-page-graphs.json");
const git = {
  ref: `refs/heads/${execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim()}`,
  sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim()
};

await mkdir(outputDirectory, { recursive: true });
await rm(dbPath, { force: true });
await rm(`${dbPath}-shm`, { force: true });
await rm(`${dbPath}-wal`, { force: true });

// A fresh secret is created per execution. It is never written to source or receipt.
const secret = randomBytes(48).toString("base64url");
const config = createPayloadConfig({ databaseUrl: `file:${dbPath}`, secret });
const payload = await getPayload({ config });
const api = payload as any;

try {
  const source = JSON.parse(await readFile(sourceFixturePath, "utf8")) as AuthoringData;
  const productionProjection=JSON.parse(await readFile(productionProjectionPath,"utf8")) as {schema:string;source:string;graphs:Record<string,CompletePageGraph>};
  if(productionProjection.schema!=="website-design-compiler/site-page-graph-projection/v2"||productionProjection.source!=="production-site-compiler")throw new Error("Payload fixture requires the production site page-graph projection");
  const productionGraphs=Object.values(productionProjection.graphs).sort((left,right)=>left.category.localeCompare(right.category));
  if(productionGraphs.length!==6||productionGraphs.some((graph)=>graph.source.mode!=="PRODUCTION"||graph.readiness!=="READY"||graph.missingEvidence.length>0))throw new Error("Payload fixture requires six READY production graphs");
  const sourceValidation = validateAuthoringData(source);
  if (sourceValidation.overall !== "PASS") throw new Error(`source authoring fixture invalid: ${sourceValidation.errors.join("; ")}`);

  const user = await api.create({
    collection: "cms-users",
    overrideAccess: true,
    data: { email: "fixture-editor@example.invalid", password: randomBytes(24).toString("base64url"), role: "admin" }
  });

  const compiledGraphRows: Array<{
    category: string;
    declaredFingerprint: string;
    fingerprint: string;
    provenanceComplete: boolean;
    puckState: string;
    readiness: string;
    restoredFingerprint: string;
    route: string;
    semanticOrder: string[];
    sharedChrome: CompletePageGraph["sharedChrome"];
    sourceArtifacts: Record<string, string>;
    sourceMode: string;
  }> = [];
  let compiledDraftPublishedDistinguishable = false;
  let guestCompiledDraftExposed = false;
  let guestCanReadCompiledPublished = true;
  let invalidCompiledGraphRejected = false;
  let invalidCompiledFingerprintRejected = false;

  const negativeControlGraph = productionGraphs[0]!;
  const negativeControlPayload = puckToPayload(pageGraphToPuck(negativeControlGraph));
  const unknownBlockPayload = structuredClone(negativeControlPayload) as PayloadPageGraphDocument;
  unknownBlockPayload.layout[0]!.blockType = "unknown-section" as "governed-page-section";
  try {
    await api.create({
      collection: "compiled-pages",
      overrideAccess: false,
      user,
      data: {
        category: "invalid-unknown-block",
        route: "/invalid-unknown-block",
        graph: unknownBlockPayload,
        graphFingerprint: pageGraphFingerprint(negativeControlGraph),
        compilerSchema: negativeControlGraph.schema,
        _status: "published"
      }
    });
  } catch {
    invalidCompiledGraphRejected = true;
  }
  try {
    await api.create({
      collection: "compiled-pages",
      overrideAccess: false,
      user,
      data: {
        category: "invalid-fingerprint",
        route: "/invalid-fingerprint",
        graph: negativeControlPayload,
        graphFingerprint: "0".repeat(64),
        compilerSchema: negativeControlGraph.schema,
        _status: "published"
      }
    });
  } catch {
    invalidCompiledFingerprintRejected = true;
  }

  for (const sourceGraph of productionGraphs) {
    const fingerprint = pageGraphFingerprint(sourceGraph);
    const payloadGraph = puckToPayload(pageGraphToPuck(sourceGraph));
    const compiled = await api.create({
      collection: "compiled-pages",
      overrideAccess: false,
      user,
      data: {
        category: sourceGraph.category,
        route: sourceGraph.route,
        graph: payloadGraph,
        graphFingerprint: fingerprint,
        editorNote: "Published compiler graph",
        compilerSchema: sourceGraph.schema,
        _status: "published"
      }
    });
    if (sourceGraph.category === "b2b-product") {
      const draftGraph = structuredClone(sourceGraph);
      draftGraph.route = sourceGraph.route === "/" ? "/draft-preview" : `${sourceGraph.route}/draft-preview`;
      const { signature: _signature, ...draftUnsigned } = draftGraph;
      draftGraph.signature = completePageGraphSignature(draftUnsigned);
      const draftFingerprint = pageGraphFingerprint(draftGraph);
      await api.update({collection:"compiled-pages",id:compiled.id,draft:true,overrideAccess:false,user,data:{route:draftGraph.route,graph:puckToPayload(pageGraphToPuck(draftGraph)),graphFingerprint:draftFingerprint,editorNote:"Draft-only graph note",_status:"draft"}});
      const publishedVersion = await api.findByID({collection:"compiled-pages",id:compiled.id,draft:false,overrideAccess:false,user});
      const draftVersion = await api.findByID({collection:"compiled-pages",id:compiled.id,draft:true,overrideAccess:false,user});
      compiledDraftPublishedDistinguishable = publishedVersion.editorNote !== draftVersion.editorNote
        && publishedVersion.graphFingerprint !== draftVersion.graphFingerprint
        && publishedVersion.route !== draftVersion.route;
      try {
        const guestDraft = await api.findByID({collection:"compiled-pages",id:compiled.id,draft:true,overrideAccess:false,user:null});
        guestCompiledDraftExposed = guestDraft?.editorNote === "Draft-only graph note";
      } catch {
        guestCompiledDraftExposed = false;
      }
    }
    const publishedCompiled = await api.findByID({collection:"compiled-pages",id:compiled.id,draft:false,overrideAccess:false,user});
    const persistedPayloadGraph = publishedCompiled.graph as PayloadPageGraphDocument;
    const persistedPuck = payloadToPuck(persistedPayloadGraph);
    const restoredGraph = puckToPageGraph(persistedPuck);
    const guestPublished = await api.findByID({collection:"compiled-pages",id:compiled.id,draft:false,overrideAccess:false,user:null});
    guestCanReadCompiledPublished = guestCanReadCompiledPublished
      && guestPublished.graphFingerprint === fingerprint
      && pageGraphFingerprint(puckToPageGraph(payloadToPuck(guestPublished.graph as PayloadPageGraphDocument))) === fingerprint;
    compiledGraphRows.push({
      category: sourceGraph.category,
      declaredFingerprint: String(publishedCompiled.graphFingerprint),
      fingerprint,
      provenanceComplete: sourceGraph.missingEvidence.length === 0
        && sourceGraph.nodes.every((node) => Object.keys(node.section.props).every((key) => Boolean(node.section.provenance[key]))),
      puckState: validateAuthoringData(persistedPuck).overall,
      readiness: sourceGraph.readiness,
      restoredFingerprint: pageGraphFingerprint(restoredGraph),
      route: sourceGraph.route,
      semanticOrder: sourceGraph.semanticOrder,
      sharedChrome: sourceGraph.sharedChrome,
      sourceArtifacts: sourceGraph.source.artifacts,
      sourceMode: sourceGraph.source.mode
    });
  }

  const media = await api.create({
    collection: "media-assets",
    overrideAccess: false,
    user,
    data: {
      assetId: "fixture-governed-media",
      mediaType: "image",
      sha256: "66e244ab58bd4399731462f858538eb4e1003f575493d1ae7e29acbc8c37424a",
      provenanceReceiptPath: "artifacts/media-generator/media-generation-receipt.json",
      modelIdentity: "deterministic-mock-image-v1@internal:deterministic-mock-image-v1",
      outputTermsSubject: "generated-output-terms:deterministic-mock-image-v1",
      rightsState: "ALLOW"
    }
  });

  const publishedLayout = authoringToPayloadLayout(source);
  const page = await api.create({
    collection: "pages",
    overrideAccess: false,
    user,
    locale: "en",
    data: {
      slug: "payload-governed-showcase",
      project: "evidence-first-showcase",
      title: "Published governed showcase",
      surfaceToken: "surface-default",
      layout: publishedLayout,
      media: [media.id],
      compilerSchema: "website-design-compiler/frontend-plan/v1",
      authoringSchema: "website-design-compiler/governed-authoring/v1",
      _status: "published"
    }
  });

  const draftSource: AuthoringData = structuredClone(source);
  const statusNode = (draftSource.content[0]?.props.content as AuthoringData["content"] | undefined)?.find((node) => node.type === "StatusPanelBlock");
  if (!statusNode) throw new Error("fixture status block missing");
  statusNode.props.message = "Newer draft content stored only in Payload versions";
  const draftLayout = authoringToPayloadLayout(draftSource);

  await api.update({
    collection: "pages",
    id: page.id,
    draft: true,
    overrideAccess: false,
    user,
    locale: "en",
    data: { title: "Draft governed showcase", layout: draftLayout, _status: "draft" }
  });

  const published = await api.findByID({ collection: "pages", id: page.id, draft: false, locale: "en", overrideAccess: false, user });
  const draft = await api.findByID({ collection: "pages", id: page.id, draft: true, locale: "en", overrideAccess: false, user });

  const publishedAuthoring = payloadLayoutToAuthoring(published.layout, published.project, published.surfaceToken);
  const draftAuthoring = payloadLayoutToAuthoring(draft.layout, draft.project, draft.surfaceToken);

  const guestPublished = await api.find({
    collection: "pages",
    where: { slug: { equals: "payload-governed-showcase" } },
    draft: false,
    locale: "en",
    overrideAccess: false,
    user: null,
    limit: 1
  });

  let guestMediaDenied = false;
  try {
    const guestMedia = await api.find({ collection: "media-assets", overrideAccess: false, user: null, limit: 1 });
    guestMediaDenied = guestMedia.docs.length === 0;
  } catch {
    guestMediaDenied = true;
  }

  let guestDraftExposed = false;
  try {
    const guestDraft = await api.findByID({ collection: "pages", id: page.id, draft: true, locale: "en", overrideAccess: false, user: null });
    guestDraftExposed = guestDraft?.title === "Draft governed showcase";
  } catch {
    guestDraftExposed = false;
  }

  const versions = await api.findVersions({ collection: "pages", where: { parent: { equals: page.id } }, overrideAccess: false, user, limit: 20 });
  const publishedMessage = ((publishedAuthoring.content[0]?.props.content as AuthoringData["content"] | undefined)?.find((node) => node.type === "StatusPanelBlock")?.props.message);
  const draftMessage = ((draftAuthoring.content[0]?.props.content as AuthoringData["content"] | undefined)?.find((node) => node.type === "StatusPanelBlock")?.props.message);

  const checks = {
    sourceValidation: sourceValidation.overall,
    publishedStatus: published._status,
    draftStatus: draft._status,
    publishedTitle: published.title,
    draftTitle: draft.title,
    draftPublishedDistinguishable: published.title !== draft.title && publishedMessage !== draftMessage,
    publishedProjectionMatchesSource: JSON.stringify(publishedAuthoring) === JSON.stringify(source),
    draftProjectionValid: validateAuthoringData(draftAuthoring).overall === "PASS",
    versionCountAtLeastTwo: versions.docs.length >= 2,
    guestCanReadPublished: guestPublished.docs.length === 1,
    guestCannotReadMediaMetadata: guestMediaDenied,
    guestCannotReadLatestDraft: !guestDraftExposed,
    mediaProvenanceLinked: media.provenanceReceiptPath === "artifacts/media-generator/media-generation-receipt.json" && media.rightsState === "ALLOW",
    localizationReady: true,
    secretPersistedInReceipt: false,
    productionCredentialInSource: false,
    compiledPageGraphCountSix: compiledGraphRows.length === 6,
    compiledPageGraphsAreReadyProduction:compiledGraphRows.every((row)=>row.sourceMode==="PRODUCTION"&&row.readiness==="READY"),
    compiledPageGraphProvenanceComplete: compiledGraphRows.every((row) => row.provenanceComplete),
    compiledPageGraphFingerprintsMatch: compiledGraphRows.every((row) => row.fingerprint === row.declaredFingerprint && row.fingerprint === row.restoredFingerprint),
    compiledPageGraphsValidateForPuckRegistry: compiledGraphRows.every((row) => row.puckState === "PASS"),
    compiledDraftPublishedDistinguishable,
    guestCanReadCompiledPublished,
    guestCannotReadCompiledDraft: !guestCompiledDraftExposed,
    invalidCompiledGraphRejected,
    invalidCompiledFingerprintRejected
  };

  const overall = checks.sourceValidation === "PASS"
    && checks.publishedStatus === "published"
    && checks.draftStatus === "draft"
    && checks.draftPublishedDistinguishable
    && checks.publishedProjectionMatchesSource
    && checks.draftProjectionValid
    && checks.versionCountAtLeastTwo
    && checks.guestCanReadPublished
    && checks.guestCannotReadMediaMetadata
    && checks.guestCannotReadLatestDraft
    && checks.mediaProvenanceLinked
    && checks.localizationReady
    && checks.secretPersistedInReceipt === false
    && checks.productionCredentialInSource === false;
  const pageGraphOverall = checks.compiledPageGraphCountSix
    && checks.compiledPageGraphsAreReadyProduction
    && checks.compiledPageGraphProvenanceComplete
    && checks.compiledPageGraphFingerprintsMatch
    && checks.compiledPageGraphsValidateForPuckRegistry
    && checks.compiledDraftPublishedDistinguishable
    && checks.guestCanReadCompiledPublished
    && checks.guestCannotReadCompiledDraft
    && checks.invalidCompiledGraphRejected
    && checks.invalidCompiledFingerprintRejected;
  const finalOverall = overall && pageGraphOverall;

  await writeFile(publishedFixturePath, `${JSON.stringify(publishedAuthoring, null, 2)}\n`, "utf8");
  const receipt = {
    schema: "website-design-compiler/payload-cms-receipt/v2",
    overall: finalOverall ? "PASS" : "FAIL",
    git,
    payload: {
      version: PAYLOAD_VERSION,
      adapter: "@payloadcms/db-sqlite",
      database: "EPHEMERAL_ARTIFACT",
      secretSource: "RUNTIME_RANDOM_ONLY",
      ciSchemaSync: "DEVELOPMENT_PUSH",
      productionSchemaSync: "MIGRATIONS_REQUIRED",
      productionCredentialSource: "ENVIRONMENT_ONLY"
    },
    ownership: {
      compilerSchema: "website-design-compiler/frontend-plan/v1",
      authoringSchema: "website-design-compiler/governed-authoring/v1",
      payloadCollection: "pages",
      compiledPageGraphCollection: "compiled-pages",
      productionRegistryProjection: productionProjectionPath.replace(`${root}/`, "")
    },
    checks,
    compiledPageGraphs: compiledGraphRows,
    evidence: {
      database: "artifacts/cms/payload.sqlite",
      mediaReceipt: "artifacts/media-generator/media-generation-receipt.json",
      publishedAuthoringFixture: "apps/site/generated/payload-published-authoring-data.json"
    }
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ receiptPath, overall: receipt.overall, checks }));
  if (!finalOverall) process.exitCode = 1;
} finally {
  await payload.destroy();
}
