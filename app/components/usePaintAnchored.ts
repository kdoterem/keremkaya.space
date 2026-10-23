"use client";

import { useEffect } from "react";
import { anchorsFor, anchoredTexture } from "@/lib/paint";

// Letter-pinned paint (see anchorsFor in lib/paint): the same `paintKey`
// gives the same splashes on the same letters at any size, so a poem's title
// in the /writing list matches its title on the poem's page. Only lime is
// laid over the text; the rest of each letter keeps the element's own colour
// (through currentColor), so hover/active colour changes still work. With
// `lazy`, nothing is drawn until the element nears the screen — the /writing
// list has hundreds of titles.
export function usePaintAnchored(
  ref: React.RefObject<HTMLElement | null>,
  paintKey: string,
  { size = 1, lazy = false }: { size?: number; lazy?: boolean } = {},
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !paintKey) return;
    let last = "";
    const paint = () => {
      const text = el.textContent ?? "";
      const sig = [el.offsetWidth, el.offsetHeight, getComputedStyle(el).fontSize, text].join("|");
      if (sig === last) return;
      const url = anchoredTexture(el, anchorsFor(text, paintKey), size);
      if (!url) return;
      last = sig;
      Object.assign(el.style, {
        backgroundImage: `url(${url}), linear-gradient(currentColor, currentColor)`,
        backgroundSize: `${el.offsetWidth}px ${el.offsetHeight}px, 100% 100%`,
        backgroundRepeat: "no-repeat",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
      } as Partial<CSSStyleDeclaration>);
    };
    const ro = new ResizeObserver(paint);
    const mo = new MutationObserver(paint);
    const start = () => {
      paint();
      ro.observe(el);
      mo.observe(el, { characterData: true, childList: true, subtree: true });
    };
    let io: IntersectionObserver | null = null;
    if (lazy) {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io?.disconnect(); io = null; start(); }
      }, { rootMargin: "300px 0px" });
      io.observe(el);
    } else start();
    return () => { io?.disconnect(); ro.disconnect(); mo.disconnect(); };
  }, [ref, paintKey, size, lazy]);
}
