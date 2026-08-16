import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, type Block, type CollectionConfig } from "payload";
import { validateAuthoringData, type AuthoringComponentData, type AuthoringData } from "./puck-authoring.js";

export const PAYLOAD_VERSION = "3.86.0" as const;
export const CMS_LOCALES = ["en", "zh-TW"] as const;

const authenticated = ({ req }: { req: { user?: unknown } }) => Boolean(req.user);

export const ButtonBlock: Block = {
  slug: "button",
  interfaceName: "GovernedButtonBlock",
  fields: [
    { name: "componentId", type: "text", required: true },
    { name: "label", type: "text", required: true, localized: true },
    { name: "intent", type: "select", required: true, options: ["primary", "secondary"] }
  ]
};

export const StatusPanelBlock: Block = {
  slug: "status-panel",
  interfaceName: "GovernedStatusPanelBlock",
  fields: [
    { name: "componentId", type: "text", required: true },
    { name: "state", type: "select", required: true, options: ["loading", "empty", "error", "success"] },
    { name: "title", type: "text", required: true, localized: true },
    { name: "message", type: "textarea", required: true, localized: true }
  ]
};

export const SectionBlock: Block = {
  slug: "section",
  interfaceName: "GovernedSectionBlock",
  fields: [
    { name: "componentId", type: "text", required: true },
    { name: "surfaceToken", type: "select", required: true, options: ["surface-default", "surface-muted"] },
    { name: "content", type: "blocks", required: true, blocks: [ButtonBlock, StatusPanelBlock], maxRows: 24 }
  ]
};

export const Users: CollectionConfig = {
  slug: "cms-users",
  auth: { maxLoginAttempts: 5, lockTime: 10 * 60 * 1000 },
  admin: { useAsTitle: "email" },
  access: {
    admin: authenticated,
    create: authenticated,
    read: authenticated,
    update: authenticated,
    delete: authenticated
  },
  fields: [{ name: "role", type: "select", required: true, defaultValue: "editor", options: ["editor", "admin"] }]
};

export const MediaAssets: CollectionConfig = {
  slug: "media-assets",
  admin: { useAsTitle: "assetId" },
  access: { create: authenticated, read: authenticated, update: authenticated, delete: authenticated },
  fields: [
    { name: "assetId", type: "text", required: true, unique: true },
    { name: "mediaType", type: "select", required: true, options: ["image", "video", "3d"] },
    { name: "sha256", type: "text", required: true },
    { name: "provenanceReceiptPath", type: "text", required: true },
    { name: "modelIdentity", type: "text", required: true },
    { name: "outputTermsSubject", type: "text", required: true },
    { name: "rightsState", type: "select", required: true, options: ["ALLOW", "REVIEW_REQUIRED", "DENY"] }
  ]
};

export const Pages: CollectionConfig = {
  slug: "pages",
  admin: { useAsTitle: "title" },
  versions: { drafts: { validate: true }, maxPerDoc: 50 },
  access: {
    create: authenticated,
    update: authenticated,
    delete: authenticated,
    readVersions: authenticated,
    read: ({ req }) => req.user ? true : { _status: { equals: "published" } }
  },
  fields: [
    { name: "slug", type: "text", required: true, unique: true },
    { name: "project", type: "text", required: true },
    { name: "title", type: "text", required: true, localized: true },
    { name: "surfaceToken", type: "select", required: true, defaultValue: "surface-default", options: ["surface-default", "surface-muted"] },
    {
      name: "layout",
      type: "blocks",
      required: true,
      localized: true,
      blocks: [ButtonBlock, StatusPanelBlock, SectionBlock],
      maxRows: 64,
      validate: (value) => {
        try {
          const data = payloadLayoutToAuthoring(value, "Payload validation", "surface-default");
          const result = validateAuthoringData(data);
          return result.overall === "PASS" ? true : result.errors.join("; ");
        } catch (error) {
          return error instanceof Error ? error.message : "invalid governed Payload layout";
        }
      }
    },
    {
      name: "media",
      type: "relationship",
      relationTo: "media-assets",
      hasMany: true,
      required: false
    },
    { name: "compilerSchema", type: "text", required: true, defaultValue: "website-design-compiler/frontend-plan/v1" },
    { name: "authoringSchema", type: "text", required: true, defaultValue: "website-design-compiler/governed-authoring/v1" }
  ]
};

type PayloadBlock = Record<string, unknown> & { blockType: string };

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${path} must be non-empty text`);
  return value;
}

function toPayloadBlock(component: AuthoringComponentData): PayloadBlock {
  if (component.type === "ButtonBlock") return {
    blockType: "button",
    componentId: component.props.id,
    label: component.props.label,
    intent: component.props.intent
  };
  if (component.type === "StatusPanelBlock") return {
    blockType: "status-panel",
    componentId: component.props.id,
    state: component.props.state,
    title: component.props.title,
    message: component.props.message
  };
  return {
    blockType: "section",
    componentId: component.props.id,
    surfaceToken: component.props.surfaceToken,
    content: (component.props.content as AuthoringComponentData[]).map(toPayloadBlock)
  };
}

function fromPayloadBlock(block: PayloadBlock): AuthoringComponentData {
  const id = requireString(block.componentId, "payload block componentId");
  if (block.blockType === "button") return {
    type: "ButtonBlock",
    props: { id, label: requireString(block.label, "button label"), intent: block.intent }
  };
  if (block.blockType === "status-panel") return {
    type: "StatusPanelBlock",
    props: {
      id,
      state: block.state,
      title: requireString(block.title, "status title"),
      message: requireString(block.message, "status message")
    }
  };
  if (block.blockType === "section") {
    if (!Array.isArray(block.content)) throw new Error("section content must be a block array");
    return {
      type: "Section",
      props: {
        id,
        surfaceToken: block.surfaceToken,
        content: block.content.map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof (entry as Record<string, unknown>).blockType !== "string") throw new Error("section child is not a governed Payload block");
          return fromPayloadBlock(entry as PayloadBlock);
        })
      }
    };
  }
  throw new Error(`Payload block type ${block.blockType} is not governed`);
}

export function authoringToPayloadLayout(data: AuthoringData): PayloadBlock[] {
  const validation = validateAuthoringData(data);
  if (validation.overall !== "PASS") throw new Error(`authoring data failed validation: ${validation.errors.join("; ")}`);
  return data.content.map(toPayloadBlock);
}

export function payloadLayoutToAuthoring(layout: unknown, pageTitle: string, surfaceToken: "surface-default" | "surface-muted"): AuthoringData {
  if (!Array.isArray(layout)) throw new Error("Payload layout must be an array");
  const content = layout.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof (entry as Record<string, unknown>).blockType !== "string") throw new Error("Payload layout entry is not a governed block");
    return fromPayloadBlock(entry as PayloadBlock);
  });
  const data: AuthoringData = { content, root: { props: { pageTitle, surfaceToken } } };
  const validation = validateAuthoringData(data);
  if (validation.overall !== "PASS") throw new Error(`Payload layout drifted from authoring schema: ${validation.errors.join("; ")}`);
  return data;
}

export function createPayloadConfig(options: { databaseUrl: string; secret: string }) {
  if (!options.secret || options.secret.length < 16) throw new Error("Payload secret must be supplied by private runtime state");
  const developmentPush = process.env.NODE_ENV !== "production";
  return buildConfig({
    secret: options.secret,
    admin: { user: Users.slug },
    collections: [Users, Pages, MediaAssets],
    localization: { locales: [...CMS_LOCALES], defaultLocale: "en", fallback: true },
    db: sqliteAdapter({
      client: { url: options.databaseUrl },
      push: developmentPush,
      blocksAsJSON: true,
      wal: true
    }),
    typescript: { autoGenerate: false }
  });
}
