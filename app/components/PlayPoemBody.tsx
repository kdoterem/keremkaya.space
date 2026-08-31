"use client";

import { useMemo, useRef, useEffect } from "react";
import ObscurableToken from "./ObscurableToken";
import { wordWeightLevel } from "./InvisibleInkText";
import { seededPhase } from "@/lib/tagProvenance";

// ── The poem body, line by line, each legible line immediately followed
// by its own glittered write-in zone — writing happens right where the
// thought was, not disconnected in a box at the end of the whole poem.
// A line counts as "legible" if any character in it carries the chosen
// tag's weight; the exact weighted words within it still get the extra
// alive-motion treatment (via ObscurableToken), the rest of that same
// line just renders as plain legible text.
//
// Zone ids are each line's own character-start offset into the body —
// stable for a given (slug, tag) pair regardless of anything else, so
// PlayScreen can key its stored draft/attempt state off them directly.

// Deliberately much fainter than the sparkle used to obscure real text
// (SPARKLE_LAYERS in InvisibleInkText.tsx) — this sits behind whatever
// the reader is actively typing, so it needs to read as ambient texture,
// not competition for attention against their own words.
function zoneSparkleStyle(seed: number): React.CSSProperties {
  const phase = seededPhase(seed * 3.1 + 7);
  const duration = 5 + phase * 5;
  const delay = -phase * duration;
  return {
    backgroundImage:
      "radial-gradient(circle, rgba(10,10,10,0.16) 1px, transparent 1.2px), " +
      "radial-gradient(circle, rgba(10,10,10,0.10) 0.8px, transparent 1px)",
    backgroundSize: "9px 9px, 13px 11px",
    animation: `ink-twinkle ${duration}s ease-in-out infinite`,
    animationDelay: `${delay}s`,
  };
}

function PlayZone({
  value,
  onChange,
  seed,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  seed: number;
  readOnly: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Simple auto-grow — no library needed, just resets to content height on
  // every change (and once on mount, so a restored draft opens already
  // sized to fit rather than showing a scrollbar).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      placeholder="write here…"
      rows={1}
      style={{
        display: "block",
        width: "100%",
        margin: "0.4rem 0 1.4rem",
        padding: "0.5rem 0.7rem",
        fontFamily: "inherit",
        fontSize: "0.95rem",
        lineHeight: 1.6,
        color: "#0a0a0a",
        border: readOnly ? "1px solid rgba(10,10,10,0.15)" : "1px dashed rgba(10,10,10,0.32)",
        borderRadius: "4px",
        background: "transparent",
        resize: "none",
        overflow: "hidden",
        ...(readOnly ? {} : zoneSparkleStyle(seed)),
      }}
    />
  );
}

export default function PlayPoemBody({
  text,
  weights,
  revealed,
  zoneValues,
  onZoneChange,
}: {
  text: string;
  weights: number[] | undefined;
  revealed: boolean;
  zoneValues: Record<string, string>;
  onZoneChange: (id: string, value: string) => void;
}) {
  const lines = useMemo(() => {
    const raw = text.split("\n");
    let offset = 0;
    return raw.map((lineText) => {
      const start = offset;
      offset += lineText.length + 1; // +1 for the \n split() consumed
      const end = start + lineText.length;
      const isBlank = !lineText.trim();
      const isLegible = !isBlank && !!weights && weights.slice(start, end).some((w) => w > 0);
      return { text: lineText, start, end, isBlank, isLegible };
    });
  }, [text, weights]);

  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {lines.map((line, i) => {
        if (line.isBlank) return <div key={i} style={{ minHeight: "1em" }}>&nbsp;</div>;

        const tokens = line.text.split(/(\s+)/);
        let offset = line.start;
        const zoneId = String(line.start);

        return (
          <div key={i}>
            <div>
              {tokens.map((tok, j) => {
                const start = offset;
                offset += tok.length;
                if (!tok || /^\s+$/.test(tok)) return <span key={j}>{tok}</span>;
                const weight = weights ? wordWeightLevel(weights, start, tok.length) : 0;
                return <ObscurableToken key={j} text={tok} weight={weight} revealed={revealed} seed={start} />;
              })}
            </div>
            {line.isLegible && (
              <PlayZone
                value={zoneValues[zoneId] ?? ""}
                onChange={(v) => onZoneChange(zoneId, v)}
                seed={line.start}
                readOnly={revealed}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
