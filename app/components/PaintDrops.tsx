"use client";

import { useEffect, useRef } from "react";
import { LIME, dot, type Drop } from "@/lib/paint";
import { DROPS_EVENT } from "./usePaint";

// The ground under painted text catches some of the paint that flew off it.
// Only FIND ME uses this. Drops arrive in page coordinates from usePaint.
export default function PaintDrops() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const all = new Map<string, Drop[]>();
    const draw = () => {
      const cv = ref.current;
      if (!cv) return;
      const W = document.documentElement.scrollWidth, H = document.documentElement.scrollHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`; cv.style.height = `${H}px`;
      const c = cv.getContext("2d");
      if (!c) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = LIME;
      for (const drops of all.values()) {
        // about half of what flew off lands; the same half on every redraw
        drops.forEach(([x, y, s, a], i) => { if (i % 2 === 0) dot(c, x, y, s * 1.3, s * 0.9, a); });
      }
    };
    const on = (e: Event) => {
      const { key, drops } = (e as CustomEvent<{ key: string; drops: Drop[] }>).detail;
      all.set(key, drops);
      draw();
    };
    window.addEventListener(DROPS_EVENT, on);
    return () => window.removeEventListener(DROPS_EVENT, on);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 0 }}
    />
  );
}
