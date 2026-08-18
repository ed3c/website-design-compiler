import type { Data } from "@puckeditor/core";
import projection from "@/generated/benchmark-page-graphs.json";
import { StudioEditor } from "@/components/studio/studio-editor";
import { validateAuthoringData } from "../../../../src/puck-authoring";
import { pageGraphToPuck } from "../../../../src/page-graph-roundtrip";
import type { CompletePageGraph } from "../../../../src/complete-page-graph";

export default function StudioPage() {
  const graph=(projection.graphs as unknown as Record<string,CompletePageGraph>)["b2b-product"];
  if(!graph)throw new Error("generated b2b-product page graph is missing");
  const authoringData=pageGraphToPuck(graph);
  const validation = validateAuthoringData(authoringData);
  if (validation.overall !== "PASS") {
    return (
      <main data-authoring-rejected="true">
        <h1>Authoring fixture rejected</h1>
        <p>{validation.errors.join("; ")}</p>
      </main>
    );
  }

  return <StudioEditor initialData={authoringData as Data} />;
}
