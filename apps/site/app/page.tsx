import { PixiEvidence } from "@/components/graphics/pixi-evidence";
import { ThreeEvidence } from "@/components/graphics/three-evidence";
import { MotionEvidence } from "@/components/motion/motion-evidence";
import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";

export default function HomePage() {
  return (
    <main className="wdc-shell">
      <header className="wdc-hero">
        <p className="wdc-eyebrow">Evidence-first website runtime</p>
        <h1>Compile design intent into governed UI contracts.</h1>
        <p>
          The runtime consumes semantic roles and typed registry components before motion, WebGL, or generated media are allowed in.
        </p>
        <div className="wdc-actions">
          <Button>Inspect compiler contract</Button>
          <Button intent="secondary">View runtime evidence</Button>
        </div>
      </header>

      <section aria-labelledby="runtime-states">
        <h2 id="runtime-states">Explicit runtime states</h2>
        <div className="wdc-grid">
          <StatusPanel state="loading" title="Loading" message="State is visible without animation dependency." />
          <StatusPanel state="empty" title="Empty" message="No content is represented explicitly rather than silently collapsing." />
          <StatusPanel state="error" title="Error" message="Failure state is announced and does not erase recovery context." />
          <StatusPanel state="success" title="Success" message="Core content works without motion or WebGL decoration." />
        </div>
      </section>

      <MotionEvidence />
      <PixiEvidence />
      <ThreeEvidence />
    </main>
  );
}
