"use client";

import { useReducedMotion } from "framer-motion";
import { sparkleLayerStyle } from "./InvisibleInkText";

// ── A whole contiguous stretch of obscured text — one or more words plus
// the whitespace between them — rendered and toggled as ONE unit, not
// per word. Bounded to a single poem line (PlayPoemBody never lets a run
// cross a line break), so its own text can still wrap across visual rows
// on a narrow screen without recreating the bug that made per-word
// rendering necessary in the first place: `display: inline-block` (not
// `inline`) gives this span its own layout box, so `position: absolute;
// inset: 0` on the sparkle overlays correctly spans however many visual
// rows the run's own text wraps onto — inline elements fragment across
// line boxes and lose that; inline-block doesn't.
//
// Peeking now reveals (and can re-hide) the whole run at once, not one
// word at a time — a deliberate change, made for the same reason as the
// sparkle batching: one click handler per run instead of one per word
// keeps the interactive surface cheap too, not just the animation.
export default function ObscurableRun({
  text,
  seed,
  revealed,
  onToggle,
}: {
  text: string;
  seed: number;
  revealed: boolean;
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();

  if (revealed) {
    return (
      <span
        onClick={onToggle}
        style={{
          cursor: "pointer",
          textDecoration: "underline",
          textDecorationColor: "rgba(10,10,10,0.22)",
          textUnderlineOffset: "3px",
        }}
      >
        {text}
      </span>
    );
  }

  if (reduceMotion) {
    return (
      <span onClick={onToggle} style={{ opacity: 0.35, cursor: "pointer" }}>
        {text}
      </span>
    );
  }

  return (
    <span onClick={onToggle} style={{ position: "relative", display: "inline-block", cursor: "pointer" }}>
      <span style={{ opacity: 0 }}>{text}</span>
      {[0, 1, 2].map((layerIndex) => (
        <span
          key={layerIndex}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            ...sparkleLayerStyle(seed + layerIndex * 3, layerIndex),
          }}
        >
          {text}
        </span>
      ))}
    </span>
  );
}
