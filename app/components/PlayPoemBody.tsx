"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import ObscurableToken from "./ObscurableToken";
import { wordWeightLevel } from "./InvisibleInkText";
import { splitPoemLines, groupLegiblePassages, ANYWHERE_ZONE_ID } from "@/lib/playLines";

// ── The poem body, rendered as one continuous read — legible passages
// (grouped runs of consecutive tag-weighted lines, not one zone per
// individual line: see groupLegiblePassages) stay unbroken text, exactly
// as written. Nothing to write in is visible by default; a quiet
// "+ write here" appears once, after each passage and once more at the
// very end ("anywhere") — reading isn't interrupted by boxes, and
// writing only appears once actually chosen. Opening one and leaving it
// empty collapses back to the prompt on the next visit; anything
// actually written stays open.
//
// Peek state (which obscured words have been tapped open) lives in
// PlayScreen, not here — it's persisted there the same way the draft is,
// so this component stays a pure function of its props.
function PlayZone({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
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

  // Only true for a zone just opened by clicking its prompt this
  // session — a zone already showing because it has restored draft text
  // must never steal focus on page load.
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

function WritePrompt({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        background: "none",
        border: "none",
        padding: 0,
        margin: "0.3rem 0 1.3rem",
        cursor: "pointer",
        fontSize: "0.78rem",
        fontStyle: "italic",
        color: "rgba(10,10,10,0.4)",
      }}
    >
      + {label}
    </button>
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
  const [openZones, setOpenZones] = useState<Set<string>>(new Set());
  const openZone = useCallback((id: string) => {
    setOpenZones((prev) => new Set(prev).add(id));
  }, []);

  const lines = splitPoemLines(text, weights);
  const passages = groupLegiblePassages(lines);
  // Which line, if any, is the LAST line of a passage — that's where its
  // one write-in point belongs, keyed by the passage's own zone id.
  const passageEndsAt = new Map(
    passages.map((p) => [p.lines[p.lines.length - 1].start, String(p.start)]),
  );

  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {lines.map((line, i) => {
        if (line.isBlank) return <div key={i} style={{ minHeight: "1em" }}>&nbsp;</div>;

        const tokens = line.text.split(/(\s+)/);
        let offset = line.start;
        const zoneId = passageEndsAt.get(line.start);

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
            {zoneId && (
              openZones.has(zoneId) || (zoneValues[zoneId] ?? "").trim() ? (
                <PlayZone
                  value={zoneValues[zoneId] ?? ""}
                  onChange={(v) => onZoneChange(zoneId, v)}
                  autoFocus={openZones.has(zoneId) && !(zoneValues[zoneId] ?? "").trim()}
                />
              ) : (
                <WritePrompt label="write here" onClick={() => openZone(zoneId)} />
              )
            )}
          </div>
        );
      })}

      <div style={{ marginTop: "0.5rem" }}>
        {openZones.has(ANYWHERE_ZONE_ID) || (zoneValues[ANYWHERE_ZONE_ID] ?? "").trim() ? (
          <>
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
              autoFocus={openZones.has(ANYWHERE_ZONE_ID) && !(zoneValues[ANYWHERE_ZONE_ID] ?? "").trim()}
            />
          </>
        ) : (
          <WritePrompt label="write anything else, anywhere" onClick={() => openZone(ANYWHERE_ZONE_ID)} />
        )}
      </div>
    </div>
  );
}
