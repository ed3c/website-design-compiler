import type { Data } from "@puckeditor/core";
import authoringData from "@/generated/showcase-authoring-data.json";
import payloadPublishedData from "@/generated/payload-published-authoring-data.json";
import { GovernedRender } from "@/components/studio/governed-render";
import { validateAuthoringData } from "../../../../../src/puck-authoring";

export default async function StudioRenderPage({ searchParams }: { searchParams: Promise<{ fixture?: string; source?: string }> }) {
  const params = await searchParams;
  const candidate: unknown = params.fixture === "invalid"
    ? { content: [{ type: "RawHtml", props: { id: "invalid", html: "<script>no</script>" } }], root: {} }
    : params.source === "payload"
      ? payloadPublishedData
      : authoringData;
  const validation = validateAuthoringData(candidate);

  if (validation.overall !== "PASS") {
    return (
      <main data-authoring-rejected="true">
        <h1>Authoring data rejected</h1>
        <p>Unknown or invalid components cannot enter the production registry.</p>
        <pre>{validation.errors.join("\n")}</pre>
      </main>
    );
  }

  return (
    <main data-authoring-source={params.source === "payload" ? "payload" : "fixture"}>
      <GovernedRender data={candidate as Data} />
    </main>
  );
}
