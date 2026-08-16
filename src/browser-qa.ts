export interface BrowserProjectResult {
  projectName: string;
  status: "passed" | "failed" | "skipped" | "unknown";
}

function normalizeResultStatus(value: unknown): BrowserProjectResult["status"] {
  if (value === "passed") return "passed";
  if (value === "failed" || value === "timedOut" || value === "interrupted") return "failed";
  if (value === "skipped") return "skipped";
  return "unknown";
}

export function collectBrowserProjectResults(report: unknown): BrowserProjectResult[] {
  const byProject = new Map<string, BrowserProjectResult["status"]>();

  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;

    if (typeof object.projectName === "string" && Array.isArray(object.results)) {
      const resultStatuses = object.results
        .filter((result): result is Record<string, unknown> => Boolean(result) && typeof result === "object")
        .map((result) => normalizeResultStatus(result.status));

      let status: BrowserProjectResult["status"] = "unknown";
      if (resultStatuses.includes("failed")) status = "failed";
      else if (resultStatuses.includes("passed")) status = "passed";
      else if (resultStatuses.length > 0 && resultStatuses.every((item) => item === "skipped")) status = "skipped";

      const previous = byProject.get(object.projectName);
      if (previous === "failed" || status === "failed") byProject.set(object.projectName, "failed");
      else if (previous === "passed" || status === "passed") byProject.set(object.projectName, "passed");
      else byProject.set(object.projectName, status);
    }

    for (const nested of Object.values(object)) {
      if (Array.isArray(nested)) {
        for (const item of nested) visit(item);
      } else {
        visit(nested);
      }
    }
  }

  visit(report);
  return [...byProject.entries()]
    .map(([projectName, status]) => ({ projectName, status }))
    .sort((left, right) => left.projectName.localeCompare(right.projectName));
}
