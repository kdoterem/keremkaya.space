"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import ObscurableToken from "./ObscurableToken";
import { wordWeightLevel } from "./InvisibleInkText";

// ── The poem body, line by line, each legible line immediately followed
// by its own write-in zone — writing happens right where the thought
// was, not disconnected in a box at the end. A line counts as "legible"
// if any character in it carries the chosen tag's weight; the exact
// weighted words within it still get the extra alive-motion treatment
// (via ObscurableToken), the rest of that same line just renders as
// plain legible text.
//
// Any obscured word can be clicked to reveal just that word — tracked
// here as a plain in-memory set (not persisted; a stuck-reader's peek,
// not a permanent spoiler), so getting unstuck on one word doesn't
// require asking to see the whole poem.
//
// Zone ids are each line's own character-start offset into the body —
// stable for a given (slug, tag) pair regardless of anything else, so
// PlayScreen can key its stored draft/attempt state off them directly.
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
}: {
  text: string;
  weights: number[] | undefined;
  zoneValues: Record<string, string>;
  onZoneChange: (id: string, value: string) => void;
}) {
  const [peeked, setPeeked] = useState<Set<number>>(new Set());
  const peek = useCallback((start: number) => {
    setPeeked((prev) => {
      const next = new Set(prev);
      next.add(start);
      return next;
    });
  }, []);

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
                const tokenRevealed = peeked.has(start);
                return (
                  <ObscurableToken
                    key={j}
                    text={tok}
                    weight={weight}
                    revealed={tokenRevealed}
                    seed={start}
                    onReveal={weight <= 0 && !tokenRevealed ? () => peek(start) : undefined}
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
    </div>
  );
}
