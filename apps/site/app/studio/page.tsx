import type { Data } from "@puckeditor/core";
import projection from "@/generated/benchmark-page-graphs.json";
import { StudioEditor } from "@/components/studio/studio-editor";
import { notFound } from "next/navigation";
import { validateAuthoringData } from "../../../../src/puck-authoring";
import { pageGraphFingerprint, pageGraphToPuck } from "../../../../src/page-graph-roundtrip";
import type { CompletePageGraph } from "../../../../src/complete-page-graph";

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category = "b2b-product" } = await searchParams;
  const graph = (projection.graphs as unknown as Record<string, CompletePageGraph>)[category];
  if (!graph) notFound();
  const authoringData = pageGraphToPuck(graph);
  const validation = validateAuthoringData(authoringData);
  if (validation.overall !== "PASS") {
    return (
      <main data-authoring-rejected="true">
        <h1>Authoring fixture rejected</h1>
        <p>{validation.errors.join("; ")}</p>
      </main>
    );
  }

  return (
    <StudioEditor
      category={category}
      expectedFingerprint={pageGraphFingerprint(graph)}
      initialData={authoringData as Data}
    />
  );
}
