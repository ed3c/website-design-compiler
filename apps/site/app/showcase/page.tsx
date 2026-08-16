import { PixiEvidence } from "@/components/graphics/pixi-evidence";
import { ThreeEvidence } from "@/components/graphics/three-evidence";
import { MotionEvidence } from "@/components/motion/motion-evidence";
import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";
import plan from "@/generated/showcase-frontend-plan.json";

function GovernedNode({ node }: { node: (typeof plan.components)[number] }) {
  if (node.component === "button") {
    const props = node.props as { intent?: "primary" | "secondary"; children: string; disabled?: boolean };
    return <Button intent={props.intent} disabled={props.disabled}>{props.children}</Button>;
  }

  if (node.component === "status-panel") {
    const props = node.props as { state: "loading" | "empty" | "error" | "success"; title: string; message: string };
    return <StatusPanel state={props.state} title={props.title} message={props.message} />;
  }

  return null;
}

export default function ShowcasePage() {
  return (
    <main className="wdc-shell" data-showcase-project={plan.project} data-governed-renderer={plan.renderer}>
      <header className="wdc-hero">
        <p className="wdc-eyebrow">End-to-end compiler showcase</p>
        <h1>Reference evidence becomes a governed, testable website runtime.</h1>
        <p>
          This route is rendered from the checked-in projection of the compiler frontend plan. Motion, 2D, and 3D remain optional enhancements and never own the primary action.
        </p>
        <div className="wdc-actions">
          {plan.components.filter((node) => node.component === "button").map((node) => <GovernedNode key={node.id} node={node} />)}
        </div>
      </header>

      <section aria-labelledby="showcase-runtime">
        <h2 id="showcase-runtime">Compiler-owned runtime evidence</h2>
        <div className="wdc-grid">
          {plan.components.filter((node) => node.component === "status-panel").map((node) => <GovernedNode key={node.id} node={node} />)}
        </div>
      </section>

      <MotionEvidence />
      <PixiEvidence />
      <ThreeEvidence />
    </main>
  );
}
