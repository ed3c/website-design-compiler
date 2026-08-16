import type { CompilerInput } from "./contracts.js";

export type ArtDirectorAuthority = "anthropic-frontend-design" | "google-stitch" | "taste-skill" | "repo-native";

export interface ArtDirectionSelection {
  primary: ArtDirectorAuthority[];
  reviewers?: ArtDirectorAuthority[];
}

export interface DesignRead {
  schema: "website-design-compiler/design-read/v1";
  project: string;
  primaryAuthority: ArtDirectorAuthority;
  reviewers: ArtDirectorAuthority[];
  pageType: string;
  audience: string;
  objective: string;
  evidencePolicy: "REFERENCE_FACTS_ONLY";
  referenceEvidenceState: "PRESENT" | "ABSENT";
}

export class ArtDirectionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtDirectionConflictError";
  }
}

export function routeArtDirection(
  input: CompilerInput,
  selection: ArtDirectionSelection,
  observedReferenceCount: number
): DesignRead {
  if (selection.primary.length !== 1) {
    throw new ArtDirectionConflictError(
      `exactly one primary art director is required; received ${selection.primary.length}`
    );
  }

  const primaryAuthority = selection.primary[0];
  if (!primaryAuthority) {
    throw new ArtDirectionConflictError("primary art director is missing");
  }

  const reviewers = Array.from(new Set(selection.reviewers ?? [])).filter(
    (authority) => authority !== primaryAuthority
  );

  return {
    schema: "website-design-compiler/design-read/v1",
    project: input.project,
    primaryAuthority,
    reviewers,
    pageType: input.brief.pageType,
    audience: input.brief.audience,
    objective: input.brief.objective,
    evidencePolicy: "REFERENCE_FACTS_ONLY",
    referenceEvidenceState: observedReferenceCount > 0 ? "PRESENT" : "ABSENT"
  };
}
