import type { Data } from "@puckeditor/core";
import authoringData from "@/generated/showcase-authoring-data.json";
import { StudioEditor } from "@/components/studio/studio-editor";
import { validateAuthoringData } from "../../../../src/puck-authoring";

export default function StudioPage() {
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
