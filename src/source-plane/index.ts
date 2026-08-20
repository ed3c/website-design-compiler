export * from "./manifest.js";
export * from "./observations.js";
export * from "./article-adapter.js";
export * from "./repository-adapter.js";
export * from "./pdf-boundary.js";

import { adaptArticle, type ArticleAdapterInput, type ArticleAdapterResult } from "./article-adapter.js";
import { adaptRepositorySnapshot, type RepositoryAdapterInput, type RepositoryAdapterResult } from "./repository-adapter.js";
import {
  createPdfNotExercisedReceipt,
  createPdfSourceRequest,
  type PdfParseReceipt,
  type PdfSourceRequest,
  type PdfSourceRequestInput
} from "./pdf-boundary.js";

export interface ObservedNormalizedSource<T extends ArticleAdapterResult | RepositoryAdapterResult> {
  schema: "website-design-compiler/normalized-source/v1";
  sourceClass: "ARTICLE" | "GIT_REPOSITORY";
  state: "OBSERVED";
  normalizedSourceIdentitySha256: string;
  result: T;
}

export interface PdfNormalizedSource {
  schema: "website-design-compiler/normalized-source/v1";
  sourceClass: "PDF";
  state: "NOT_EXERCISED";
  normalizedSourceIdentitySha256: string;
  request: PdfSourceRequest;
  receipt: PdfParseReceipt;
}

export type NormalizedSource =
  | ObservedNormalizedSource<ArticleAdapterResult>
  | ObservedNormalizedSource<RepositoryAdapterResult>
  | PdfNormalizedSource;

export function normalizeArticleSource(input: ArticleAdapterInput): ObservedNormalizedSource<ArticleAdapterResult> {
  const result = adaptArticle(input);
  return {
    schema: "website-design-compiler/normalized-source/v1",
    sourceClass: "ARTICLE",
    state: "OBSERVED",
    normalizedSourceIdentitySha256: result.manifest.sourceIdentitySha256,
    result
  };
}

export function normalizeRepositorySource(input: RepositoryAdapterInput): ObservedNormalizedSource<RepositoryAdapterResult> {
  const result = adaptRepositorySnapshot(input);
  return {
    schema: "website-design-compiler/normalized-source/v1",
    sourceClass: "GIT_REPOSITORY",
    state: "OBSERVED",
    normalizedSourceIdentitySha256: result.manifest.sourceIdentitySha256,
    result
  };
}

export function normalizePdfDigestSource(input: PdfSourceRequestInput, evaluatedAt: string): PdfNormalizedSource {
  const request = createPdfSourceRequest(input);
  const receipt = createPdfNotExercisedReceipt(request, evaluatedAt);
  return {
    schema: "website-design-compiler/normalized-source/v1",
    sourceClass: "PDF",
    state: "NOT_EXERCISED",
    normalizedSourceIdentitySha256: request.requestIdentitySha256,
    request,
    receipt
  };
}
