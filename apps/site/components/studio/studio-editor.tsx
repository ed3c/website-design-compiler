"use client";

import { Puck, type Data } from "@puckeditor/core";
import { useState } from "react";
import { validateAuthoringData } from "../../../../src/puck-authoring";
import { studioConfig } from "./puck-config";

type StudioEditorProps = {
  initialData: Data;
};

export function StudioEditor({ initialData }: StudioEditorProps) {
  const [status, setStatus] = useState<"idle" | "saved" | "rejected">("idle");
  const [errors, setErrors] = useState<string[]>([]);

  return (
    <div data-authoring-studio="true" data-save-state={status}>
      <Puck
        config={studioConfig}
        data={initialData}
        headerTitle="Website Design Compiler Studio"
        onPublish={(data) => {
          const validation = validateAuthoringData(data);
          if (validation.overall !== "PASS") {
            setErrors(validation.errors);
            setStatus("rejected");
            return;
          }
          window.localStorage.setItem("wdc:puck-page", JSON.stringify(data));
          setErrors([]);
          setStatus("saved");
        }}
      />
      <div role="status" aria-live="polite" data-authoring-save-status="true">
        {status === "saved" ? "Governed page data saved locally." : null}
        {status === "rejected" ? `Save rejected: ${errors.join("; ")}` : null}
      </div>
    </div>
  );
}
