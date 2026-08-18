import { NextResponse } from "next/server";
import { pageGraphFingerprint, puckToPageGraph } from "../../../../../../src/page-graph-roundtrip";
import { validateAuthoringData } from "../../../../../../src/puck-authoring";

export async function POST(request: Request) {
  try {
    const data: unknown = await request.json();
    const validation = validateAuthoringData(data);
    if (validation.overall !== "PASS") {
      return NextResponse.json({ errors: validation.errors }, { status: 422 });
    }
    const graph = puckToPageGraph(data as Parameters<typeof puckToPageGraph>[0]);
    return NextResponse.json({
      category: graph.category,
      fingerprint: pageGraphFingerprint(graph),
      schema: "website-design-compiler/puck-publish-readback/v1"
    });
  } catch (error) {
    return NextResponse.json(
      { errors: [error instanceof Error ? error.message : "invalid Puck publication"] },
      { status: 400 }
    );
  }
}
