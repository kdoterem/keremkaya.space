"use client";

import { useEffect } from "react";
import { paintTexture, type Drop } from "@/lib/paint";

// Throws lime paint at one text element: the splashes become the element's
// own text fill. Repaints with the same throw when the element changes size
// (wrapping, a scramble settling, a resize), so the paint never smears.
// With `spill`, the far drops are announced (page coordinates) for a ground
// canvas to catch — see PaintDrops.
export const DROPS_EVENT = "paint-drops";

export function usePaint(
  ref: React.RefObject<HTMLElement | null>,
  { size = 0.8, spill = false, key = "" }: { size?: number; spill?: boolean; key?: string } = {},
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seed = (Math.random() * 1e9) | 0; // a new throw each visit
    let last = "";
    const paint = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      // where the letters sit inside the box — text that scrambles or settles
      // in can change this without the box itself changing size
      const range = document.createRange();
      range.selectNodeContents(el);
      const er = el.getBoundingClientRect(), tr = range.getBoundingClientRect();
      const sig = [w, h, tr.width, tr.left - er.left].map((v) => Math.round(v / 6)).join(",");
      if (sig === last) return;
      last = sig;
      const x0 = tr.width ? Math.max(0, tr.left - er.left) : 0, x1 = tr.width ? Math.min(w, tr.right - er.left) : w;
      const { url, drops } = paintTexture(w, h, seed, size, x0, x1);
      Object.assign(el.style, {
        backgroundImage: `url(${url})`,
        backgroundSize: `${w}px ${h}px`,
        backgroundRepeat: "no-repeat",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
      } as Partial<CSSStyleDeclaration>);
      if (spill) {
        const r = el.getBoundingClientRect();
        const atPage: Drop[] = drops.map(([x, y, s, a]) => [x + r.left + window.scrollX, y + r.top + window.scrollY, s, a]);
        window.dispatchEvent(new CustomEvent(DROPS_EVENT, { detail: { key: key || el.textContent, drops: atPage } }));
      }
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    const mo = new MutationObserver(paint);
    mo.observe(el, { characterData: true, childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [ref, size, spill, key]);
}
