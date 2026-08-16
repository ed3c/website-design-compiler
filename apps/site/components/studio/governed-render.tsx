import { Render, type Data } from "@puckeditor/core";
import { studioConfig } from "./puck-config";

export function GovernedRender({ data }: { data: Data }) {
  return (
    <div data-authoring-renderer="puck-production-registry">
      <Render config={studioConfig} data={data} />
    </div>
  );
}
