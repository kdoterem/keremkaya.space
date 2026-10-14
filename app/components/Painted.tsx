"use client";

import { useRef, type ReactNode, type CSSProperties, type Ref } from "react";
import { usePaint } from "./usePaint";

// A text element with lime paint thrown at it — for headings that live in
// server components (post titles), which can't hold a ref themselves.
export default function Painted({
  as = "span",
  size,
  style,
  className,
  children,
}: {
  as?: "h1" | "h2" | "p" | "span" | "div";
  size?: number;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  usePaint(ref, { size });
  const Tag = as as unknown as React.FC<{ ref: Ref<HTMLElement>; style?: CSSProperties; className?: string; children: ReactNode }>;
  return (
    <Tag ref={ref} style={style} className={className}>
      {children}
    </Tag>
  );
}
