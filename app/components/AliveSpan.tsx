"use client";

import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import { animate, type AnimationPlaybackControls } from "framer-motion";
import { aliveScaleFor, seededPhase } from "@/lib/tagProvenance";
import { useTextSelecting } from "@/lib/useTextSelecting";

// One drifting, breathing run of alive text (AliveWeightedText and
// InvisibleInkText both use it). Driven imperatively so it can be paused
// in place — not snapped back, not re-rendered — while the reader has text
// selected: on iOS any movement under a selection makes the copy bar vanish.
export default function AliveSpan({
  weight,
  seed,
  style,
  children,
}: {
  weight: number;
  seed: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const controls = useRef<AnimationPlaybackControls[]>([]);
  const selecting = useTextSelecting();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { driftAmpX, driftAmpY, scaleAmp } = aliveScaleFor(weight);
    const phase1 = seededPhase(seed);
    const phase2 = seededPhase(seed * 7 + 3);
    const driftDurS = 4 + phase1 * 4;
    const scaleDurS = 3 + phase2 * 3;
    controls.current = [
      animate(el, { x: [0, driftAmpX, 0, -driftAmpX, 0] }, { duration: driftDurS, repeat: Infinity, ease: "easeInOut", delay: phase2 * driftDurS }),
      animate(el, { y: [0, -driftAmpY, 0, driftAmpY, 0] }, { duration: driftDurS * 1.3, repeat: Infinity, ease: "easeInOut", delay: phase1 * driftDurS }),
      animate(el, { scale: [1, 1 + scaleAmp, 1] }, { duration: scaleDurS, repeat: Infinity, ease: "easeInOut", delay: phase1 * scaleDurS }),
    ];
    return () => { controls.current.forEach((c) => c.stop()); controls.current = []; };
  }, [weight, seed]);

  useEffect(() => {
    controls.current.forEach((c) => (selecting ? c.pause() : c.play()));
  }, [selecting]);

  return (
    <span ref={ref} style={{ display: "inline-block", ...style }}>
      {children}
    </span>
  );
}
