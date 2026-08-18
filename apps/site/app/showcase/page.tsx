import { PixiEvidence } from "@/components/graphics/pixi-evidence";
import { ThreeEvidence } from "@/components/graphics/three-evidence";
import { MotionEvidence } from "@/components/motion/motion-evidence";
import { GovernedSection } from "@/components/sections/governed-section";
import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";
import plan from "@/generated/showcase-frontend-plan.json";
import type { ComponentNode } from "../../../../src/frontend-builder";
import { validateSectionInstance } from "../../../../src/section-grammar";

function GovernedNode({ node }: { node: ComponentNode }) {
  if (node.component === "button") {
    const props = node.props;
    return <Button intent={props.intent} disabled={props.disabled}>{props.children}</Button>;
  }

  if (node.component === "status-panel") {
    const props = node.props;
    return <StatusPanel state={props.state} title={props.title} message={props.message} />;
  }

  const errors = validateSectionInstance(node.props);
  if (errors.length > 0) throw new Error(`Invalid governed showcase section ${node.id}: ${errors.join("; ")}`);
  return <GovernedSection kind={node.props.kind} variant={node.props.variant} fields={node.props.props} />;
}

export default function ShowcasePage() {
  const components = plan.components as unknown as ComponentNode[];
  return (
    <main className="wdc-shell" data-showcase-project={plan.project} data-governed-renderer={plan.renderer}>
      <header className="wdc-hero">
        <p className="wdc-eyebrow">End-to-end compiler showcase</p>
        <h1>Reference evidence becomes a governed, testable website runtime.</h1>
        <p>
          This route is rendered from the checked-in projection of the compiler frontend plan. Motion, 2D, and 3D remain optional enhancements and never own the primary action.
        </p>
      </header>

      <section aria-label="Compiler-owned governed sections">
        {components.map((node) => <div key={node.id} data-frontend-component={node.component} data-frontend-node={node.id}>
          <GovernedNode node={node} />
        </div>)}
      </section>

      <MotionEvidence />
      <PixiEvidence />
      <ThreeEvidence />
    </main>
  );
}
