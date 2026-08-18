"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { gsap } from "gsap";

export function MotionEvidence() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(false);

  useEffect(() => {
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateReducedMotion = () => {
      setPrefersReducedMotion(reducedQuery.matches);
      setMotionEnabled(!reducedQuery.matches);
    };
    updateReducedMotion();
    reducedQuery.addEventListener("change", updateReducedMotion);
    return () => reducedQuery.removeEventListener("change", updateReducedMotion);
  }, []);

  useEffect(() => {
    const element = timelineRef.current;
    if (!element) return;

    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.dataset.coarsePointer = String(coarsePointer);
    element.dataset.reducedMotion = String(reducedMotion);

    if (coarsePointer || reducedMotion) {
      element.dataset.gsapActive = "false";
      element.style.opacity = "1";
      element.style.transform = "none";
      return;
    }

    element.dataset.gsapActive = "true";
    const context = gsap.context(() => {
      gsap.fromTo(
        element,
        { opacity: 0.72, y: 8 },
        { opacity: 1, y: 0, duration: 0.42, ease: "power2.out", overwrite: "auto" }
      );
    }, element);

    const cleanup = () => {
      context.revert();
      element.dataset.gsapActive = "false";
      element.dataset.routeCleanupObserved = "true";
    };
    window.addEventListener("wdc:motion:route-change", cleanup);
    return () => {
      window.removeEventListener("wdc:motion:route-change", cleanup);
      cleanup();
    };
  }, []);

  return (
    <section className="wdc-motion-evidence" aria-labelledby="motion-evidence-title">
      <motion.div
        data-motion-id="hero-reveal"
        data-motion-engine="motion"
        data-motion-active={String(motionEnabled)}
        data-reduced-motion={String(prefersReducedMotion)}
        initial={false}
        animate={motionEnabled ? { scale: [1, 1.01, 1] } : { scale: 1 }}
        transition={motionEnabled ? { duration: 0.22, ease: "easeOut" } : { duration: 0 }}
      >
        <h2 id="motion-evidence-title">Governed motion evidence</h2>
        <p>Motion is optional hierarchy enhancement; the semantic content exists before animation runs.</p>
      </motion.div>
      <div
        ref={timelineRef}
        data-motion-id="evidence-timeline"
        data-motion-engine="gsap"
        data-gsap-active="pending"
        data-coarse-pointer="unknown"
        data-reduced-motion="unknown"
      >
        <p>GSAP owns this short timeline and reverts its context on unmount.</p>
      </div>
    </section>
  );
}
