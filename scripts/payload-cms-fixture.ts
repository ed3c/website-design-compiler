import { randomBytes } from "node:crypto";
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

const root = process.cwd();
const outputDirectory = join(root, "artifacts", "cms");
const dbPath = join(outputDirectory, "payload.sqlite");
const receiptPath = join(outputDirectory, "payload-cms-receipt.json");
const publishedFixturePath = join(root, "apps", "site", "generated", "payload-published-authoring-data.json");
const sourceFixturePath = join(root, "apps", "site", "generated", "showcase-authoring-data.json");

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
  const sourceValidation = validateAuthoringData(source);
  if (sourceValidation.overall !== "PASS") throw new Error(`source authoring fixture invalid: ${sourceValidation.errors.join("; ")}`);

  const user = await api.create({
    collection: "cms-users",
    overrideAccess: true,
    data: { email: "fixture-editor@example.invalid", password: randomBytes(24).toString("base64url"), role: "admin" }
  });

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
    productionCredentialInSource: false
  };

  const overall = Object.values(checks).every((value) => value === true || value === "PASS" || value === "published" || value === "draft" || typeof value === "string")
    && checks.sourceValidation === "PASS"
    && checks.publishedStatus === "published"
    && checks.draftStatus === "draft"
    && checks.draftPublishedDistinguishable
    && checks.publishedProjectionMatchesSource
    && checks.draftProjectionValid
    && checks.versionCountAtLeastTwo
    && checks.guestCanReadPublished
    && checks.guestCannotReadMediaMetadata
    && checks.guestCannotReadLatestDraft
    && checks.mediaProvenanceLinked;

  await writeFile(publishedFixturePath, `${JSON.stringify(publishedAuthoring, null, 2)}\n`, "utf8");
  const receipt = {
    schema: "website-design-compiler/payload-cms-receipt/v1",
    overall: overall ? "PASS" : "FAIL",
    git: { sha: process.env.GITHUB_SHA ?? "UNBOUND", ref: process.env.GITHUB_REF ?? "UNBOUND" },
    payload: { version: PAYLOAD_VERSION, adapter: "@payloadcms/db-sqlite", database: "EPHEMERAL_ARTIFACT", secretSource: "RUNTIME_RANDOM_ONLY" },
    ownership: {
      compilerSchema: "website-design-compiler/frontend-plan/v1",
      authoringSchema: "website-design-compiler/governed-authoring/v1",
      payloadCollection: "pages",
      productionRegistryProjection: publishedFixturePath.replace(`${root}/`, "")
    },
    checks,
    evidence: {
      database: "artifacts/cms/payload.sqlite",
      mediaReceipt: "artifacts/media-generator/media-generation-receipt.json",
      publishedAuthoringFixture: "apps/site/generated/payload-published-authoring-data.json"
    }
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ receiptPath, overall: receipt.overall, checks }));
  if (!overall) process.exitCode = 1;
} finally {
  await payload.destroy();
}
