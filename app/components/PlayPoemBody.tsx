"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import ObscurableToken from "./ObscurableToken";
import ObscurableRun from "./ObscurableRun";
import { wordWeightLevel } from "./InvisibleInkText";
import { splitPoemLines, groupLegiblePassages, passageZoneId, ANYWHERE_ZONE_ID } from "@/lib/playLines";

// ── The poem body, rendered as one continuous read — legible passages
// (grouped runs of consecutive tag-weighted lines, not one zone per
// individual line: see groupLegiblePassages) stay unbroken text, exactly
// as written. Nothing to write in is visible by default; a quiet prompt
// (its label set by the gateway this screen was reached through — see
// PlayScreen's promptLabel) appears once, after each passage and once
// more at the very end ("anywhere") — reading isn't interrupted by
// boxes, and writing only appears once actually chosen. Opening one and
// leaving it empty collapses back to the prompt on the next visit;
// anything actually written stays open.
//
// Each poem line renders in three tiers, per word:
//  - weight > 0: this tag's own anchor — ObscurableToken, alive motion.
//  - weight === -1: borrowed context from an adjacent tag's span, part
//    of the same argument (see the play screen route's cluster-
//    merging) — plain legible text, no motion, no sparkle.
//  - weight === 0: obscured — batched into ONE ObscurableRun per
//    contiguous stretch within the line (not one per word). That
//    batching is what actually fixed PLAY's real performance problem: a
//    typical doorway was running ~280 continuously-animated sparkle
//    elements just sitting there, some over 4,000. Grouping them the
//    same way InvisibleInkText already groups its own sparkle per line,
//    rather than per word, cuts that by roughly the run's own word
//    count with no loss of correctness — the run's boundaries come from
//    the same weight computation either way.
//
// Peek state (which LINES have been tapped open) lives in PlayScreen,
// not here — it's persisted there the same way the draft is, so this
// component stays a pure function of its props. Granularity is the
// whole line, not the individual run: a line can hold more than one
// obscured run (a legible word — its own anchor, or borrowed context
// from the cluster-merge — sitting between two obscured stretches),
// and tapping any one of them reveals every run in that line together,
// same as InvisibleInkText's own reveal unit. Simpler to reason about
// ("did I look at this line yet?" not "did I look at this fragment of
// it yet?"), and it means progressing through a poem clears a whole
// line's worth of still-animating sparkle at once rather than one
// run at a time.
function PlayZone({
  value,
  onChange,
  autoFocus,
  placeholder = "write here…",
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
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
      placeholder={placeholder}
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

// One poem line's content, tier-resolved: alive words render
// individually (existing per-word treatment, unchanged); obscured
// stretches accumulate into one combined string and flush as a single
// ObscurableRun once they hit a non-obscured token or the line's end —
// never per word. Every run in the line shares the SAME peeked/toggle
// state, keyed by the line's own start (not the run's) — see the
// header comment above for why. Each run still gets its own seed (its
// own start offset), so two runs in the same line glitter with
// different phase right up until the line's tapped open, the same
// variation a multi-run line always had.
function LineContent({
  lineText,
  lineStart,
  weights,
  peeked,
  onTogglePeek,
}: {
  lineText: string;
  lineStart: number;
  weights: number[] | undefined;
  peeked: Set<number>;
  onTogglePeek: (start: number) => void;
}) {
  const tokens = lineText.split(/(\s+)/);
  let offset = lineStart;
  const elements: React.ReactNode[] = [];
  let obscuredText = "";
  let obscuredStart: number | null = null;

  const flushObscured = () => {
    if (!obscuredText) return;
    const start = obscuredStart as number;
    elements.push(
      <ObscurableRun
        key={`obs-${start}`}
        text={obscuredText}
        seed={start}
        revealed={peeked.has(lineStart)}
        onToggle={() => onTogglePeek(lineStart)}
      />,
    );
    obscuredText = "";
    obscuredStart = null;
  };

  for (let j = 0; j < tokens.length; j++) {
    const tok = tokens[j];
    const start = offset;
    offset += tok.length;
    if (!tok) continue;

    if (/^\s+$/.test(tok)) {
      if (obscuredText) obscuredText += tok;
      else elements.push(<span key={`ws-${start}`}>{tok}</span>);
      continue;
    }

    const weight = weights ? wordWeightLevel(weights, start, tok.length) : 0;
    if (weight > 0) {
      flushObscured();
      elements.push(<ObscurableToken key={`a-${start}`} text={tok} weight={weight} seed={start} />);
    } else if (weight === -1) {
      flushObscured();
      elements.push(<span key={`c-${start}`}>{tok}</span>);
    } else {
      if (!obscuredText) obscuredStart = start;
      obscuredText += tok;
    }
  }
  flushObscured();

  return <>{elements}</>;
}

export default function PlayPoemBody({
  text,
  weights,
  promptLabel,
  zoneValues,
  onZoneChange,
  peeked,
  onTogglePeek,
}: {
  text: string;
  weights: number[] | undefined;
  promptLabel: string;
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
    passages.map((p) => [p.lines[p.lines.length - 1].start, passageZoneId(p.start)]),
  );

  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {lines.map((line, i) => {
        if (line.isBlank) return <div key={i} style={{ minHeight: "1em" }}>&nbsp;</div>;

        const zoneId = passageEndsAt.get(line.start);

        return (
          <div key={i}>
            <div>
              <LineContent
                lineText={line.text}
                lineStart={line.start}
                weights={weights}
                peeked={peeked}
                onTogglePeek={onTogglePeek}
              />
            </div>
            {zoneId && (
              openZones.has(zoneId) || (zoneValues[zoneId] ?? "").trim() ? (
                <PlayZone
                  value={zoneValues[zoneId] ?? ""}
                  onChange={(v) => onZoneChange(zoneId, v)}
                  autoFocus={openZones.has(zoneId) && !(zoneValues[zoneId] ?? "").trim()}
                  placeholder={`${promptLabel}…`}
                />
              ) : (
                <WritePrompt label={promptLabel} onClick={() => openZone(zoneId)} />
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
