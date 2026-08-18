import { GovernedSection, type GovernedSectionKind } from "./governed-section";
import { MediaOrchestrationStage, type ProjectedMediaHook } from "./media-orchestration-stage";

type ProjectedNode = {
  id: string;
  kind: GovernedSectionKind;
  variant: string;
  semanticIndex: number;
  section: { props: Record<string, unknown> };
  responsive: {
    mobile: { layout: string };
    tablet: { layout: string };
    desktop: { layout: string };
  };
  mediaHook: ProjectedMediaHook;
  motionHook: { engine: string };
};
export type ProjectedPageGraph = {
  category: string;
  readiness: "READY" | "NEEDS_INPUT";
  signature: string;
  nodes: ProjectedNode[];
};

export function GeneratedPage({ graph }: { graph: ProjectedPageGraph }) {
  return <main
    className="wdc-shell"
    data-generated-page={graph.category}
    data-page-readiness={graph.readiness}
    data-graph-signature={graph.signature}
  >
    <header className="wdc-hero">
      <p className="wdc-eyebrow">Compiler generated benchmark</p>
      <h1>{graph.category.replaceAll("-"," ")}</h1>
      <p>Rendered directly from the governed page graph projection with semantic order, responsive, motion and media contracts attached to each node.</p>
    </header>
    {graph.nodes.map((node) => <div
      key={node.id}
      data-page-node={node.id}
      data-semantic-index={node.semanticIndex}
      data-mobile-layout={node.responsive.mobile.layout}
      data-tablet-layout={node.responsive.tablet.layout}
      data-desktop-layout={node.responsive.desktop.layout}
      data-media-renderer={node.mediaHook.renderer}
      data-motion-engine={node.motionHook.engine}
    >
      <GovernedSection kind={node.kind} variant={node.variant} fields={node.section.props} />
      {node.mediaHook.renderer !== "dom"
        ? <MediaOrchestrationStage sectionId={node.id} decision={node.mediaHook} />
        : null}
    </div>)}
  </main>;
}
