"use client";

import { useRef, useEffect } from "react";
import ObscurableToken from "./ObscurableToken";
import { wordWeightLevel } from "./InvisibleInkText";
import { splitPoemLines, ANYWHERE_ZONE_ID } from "@/lib/playLines";

// ── The poem body, line by line, each legible line immediately followed
// by its own write-in zone — writing happens right where the thought
// was, not disconnected in a box at the end. A line counts as "legible"
// if any character in it carries the chosen tag's weight; the exact
// weighted words within it still get the extra alive-motion treatment
// (via ObscurableToken), the rest of that same line just renders as
// plain legible text. One more zone sits at the very end, unlinked to
// any specific line, for whatever didn't belong right after a
// particular gap.
//
// Peek state (which obscured words have been tapped open) lives in
// PlayScreen, not here — it's persisted there the same way the draft is,
// so this component stays a pure function of its props.
function PlayZone({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
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
      placeholder="write here…"
      rows={1}
      className="play-zone"
      style={{
        display: "block",
        width: "100%",
        margin: "0.3rem 0 1.3rem",
        padding: "0.2rem 0",
        fontFamily: "inherit",
        fontSize: "0.98rem",
        lineHeight: 1.7,
        color: "#0a0a0a",
        background: "transparent",
        resize: "none",
        overflow: "hidden",
      }}
    />
  );
}

export default function PlayPoemBody({
  text,
  weights,
  zoneValues,
  onZoneChange,
  peeked,
  onTogglePeek,
}: {
  text: string;
  weights: number[] | undefined;
  zoneValues: Record<string, string>;
  onZoneChange: (id: string, value: string) => void;
  peeked: Set<number>;
  onTogglePeek: (start: number) => void;
}) {
  const lines = splitPoemLines(text, weights);

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
                return (
                  <ObscurableToken
                    key={j}
                    text={tok}
                    weight={weight}
                    revealed={peeked.has(start)}
                    seed={start}
                    onToggle={weight <= 0 ? () => onTogglePeek(start) : undefined}
                  />
                );
              })}
            </div>
            {line.isLegible && (
              <PlayZone
                value={zoneValues[zoneId] ?? ""}
                onChange={(v) => onZoneChange(zoneId, v)}
              />
            )}
          </div>
        );
      })}

      <div style={{ marginTop: "0.5rem" }}>
        <p
          style={{
            fontSize: "0.62rem",
            fontWeight: 500,
            letterSpacing: "0.12em",
            fontVariant: "small-caps",
            color: "rgba(10,10,10,0.4)",
            marginBottom: "0.3rem",
          }}
        >
          anywhere
        </p>
        <PlayZone
          value={zoneValues[ANYWHERE_ZONE_ID] ?? ""}
          onChange={(v) => onZoneChange(ANYWHERE_ZONE_ID, v)}
        />
      </div>
    </div>
  );
}
