"use client";

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { gsap } from "gsap";

export function MotionEvidence() {
  const reducedMotion = useReducedMotion();
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = timelineRef.current;
    if (!element) return;

    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.dataset.coarsePointer = String(coarsePointer);
    element.dataset.reducedMotion = String(prefersReducedMotion);

    if (coarsePointer || prefersReducedMotion) {
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

    return () => context.revert();
  }, []);

  const reduce = reducedMotion === true;

  return (
    <section className="wdc-motion-evidence" aria-labelledby="motion-evidence-title">
      <motion.div
        data-motion-id="hero-reveal"
        data-motion-engine="motion"
        data-reduced-motion={String(reduce)}
        initial={reduce ? false : { opacity: 0.72, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }}
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
