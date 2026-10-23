"use client";

import { useRef, type ReactNode, type CSSProperties, type Ref } from "react";
import { usePaint } from "./usePaint";
import { usePaintAnchored } from "./usePaintAnchored";

// A text element with lime paint thrown at it — for headings that live in
// server components (post titles), which can't hold a ref themselves.
// Without paintKey it's a fresh random throw each visit; with one, the paint
// is pinned to letters and fixed by the key (a poem's slug), so it matches
// the same title anywhere else on the site.
export default function Painted({
  as = "span",
  size,
  paintKey,
  style,
  className,
  children,
}: {
  as?: "h1" | "h2" | "p" | "span" | "div";
  size?: number;
  paintKey?: string;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const none = useRef<HTMLElement>(null);
  usePaint(paintKey ? none : ref, { size });
  usePaintAnchored(paintKey ? ref : none, paintKey ?? "", { size });
  const Tag = as as unknown as React.FC<{ ref: Ref<HTMLElement>; style?: CSSProperties; className?: string; children: ReactNode }>;
  return (
    <Tag ref={ref} style={style} className={className}>
      {children}
    </Tag>
  );
}
