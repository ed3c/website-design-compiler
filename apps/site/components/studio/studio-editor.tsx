"use client";

import { Puck, type Data } from "@puckeditor/core";
import { useState } from "react";
import { validateAuthoringData } from "../../../../src/puck-authoring";
import type { PageGraphAuthoringData } from "../../../../src/page-graph-roundtrip";
import { studioConfig } from "./puck-config";

type StudioEditorProps = {
  initialData: Data;
  category: string;
  expectedFingerprint: string;
};

export function StudioEditor({ category, expectedFingerprint, initialData }: StudioEditorProps) {
  const [status, setStatus] = useState<"idle" | "saved" | "rejected">("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [publishedFingerprint, setPublishedFingerprint] = useState("");

  return (
    <div
      data-authoring-category={category}
      data-authoring-studio="true"
      data-expected-fingerprint={expectedFingerprint}
      data-published-fingerprint={publishedFingerprint}
      data-save-state={status}
    >
      <Puck
        config={studioConfig}
        data={initialData}
        headerTitle="Website Design Compiler Studio"
        onPublish={async (data) => {
          const initialGraph = initialData as unknown as PageGraphAuthoringData;
          const publishedData: PageGraphAuthoringData = {
            schema: initialGraph.schema,
            content: data.content as PageGraphAuthoringData["content"],
            root: structuredClone(initialGraph.root)
          };
          const validation = validateAuthoringData(publishedData);
          if (validation.overall !== "PASS") {
            setErrors(validation.errors);
            setStatus("rejected");
            return;
          }
          try {
            const response = await fetch("/api/studio/publish", {
              body: JSON.stringify(publishedData),
              headers: { "content-type": "application/json" },
              method: "POST"
            });
            const result = await response.json() as { errors?: string[]; fingerprint?: string };
            if (!response.ok || result.fingerprint !== expectedFingerprint) {
              throw new Error(result.errors?.join("; ") ?? "published graph fingerprint drift");
            }
            window.localStorage.setItem(`wdc:puck-page:${category}`, JSON.stringify(publishedData));
            setErrors([]);
            setPublishedFingerprint(result.fingerprint);
            setStatus("saved");
          } catch (error) {
            setErrors([error instanceof Error ? error.message : "Puck publication failed"]);
            setPublishedFingerprint("");
            setStatus("rejected");
          }
        }}
      />
      <div role="status" aria-live="polite" data-authoring-save-status="true">
        {status === "saved" ? "Governed page data saved locally." : null}
        {status === "rejected" ? `Save rejected: ${errors.join("; ")}` : null}
      </div>
    </div>
  );
}
