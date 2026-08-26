import tagProvenanceData from "@/tag-provenance.json";

// ── Tag provenance — shared between /writing and /terrain so both surfaces
// render identical emphasis for identical data: same functions, not just
// similar logic. A post with no entry here renders exactly as it always
// has (computeWeights returns undefined, callers fall back to plain text).
//
// This is deliberately data-only and hook-free — it's imported from a
// server component (app/writing/[slug]/page.tsx) as well as a client one
// (app/terrain/page.tsx), so it must work in both without a "use client"
// boundary of its own. ──

export interface ProvenanceEntry {
  type: string;
  spans?: string[];
  note?: string;
}

export interface PostProvenance {
  slug: string;
  date: string;
  tags: Record<string, ProvenanceEntry>;
}

// Each post's tags object is inferred as its own distinct literal shape
// (different posts have different tag names as literal keys) rather than a
// generic Record — a direct cast is rejected as "insufficient overlap", so
// it goes through unknown first.
const provenanceBySlug = new Map<string, Record<string, ProvenanceEntry>>(
  (tagProvenanceData as unknown as PostProvenance[]).map((p) => [p.slug, p.tags]),
);

export function getProvenanceTags(slug: string): Record<string, ProvenanceEntry> | undefined {
  return provenanceBySlug.get(slug);
}

export function hasProvenance(slug: string): boolean {
  return provenanceBySlug.has(slug);
}

// Every slug currently carrying provenance data, in no particular order —
// used by /terrain to place the MILAT seam without hardcoding a date.
export function provenanceSlugs(): string[] {
  return Array.from(provenanceBySlug.keys());
}

// The earliest date any provenance-mapped post carries — the boundary the
// MILAT seam marks. Computed from the data itself, not hardcoded, so a
// future post with an earlier date (were that ever true) would move it.
export function provenanceBoundaryDate(): string | null {
  const dates = (tagProvenanceData as unknown as PostProvenance[]).map((p) => p.date);
  if (dates.length === 0) return null;
  return dates.reduce((min, d) => (d < min ? d : min));
}

// One entry per character in `text` — how many tags' spans cover that
// position. A span is only ever located in the text it's actually found in
// (title and body call this separately), so a title-only span like "god" in
// percept-and-define-intercept-the-divine never marks anything in the body,
// and vice versa. Returns undefined (not an all-zero array) when nothing
// matched, so callers can skip the styled-runs path entirely for plain text.
export function computeWeights(
  text: string,
  tags: Record<string, ProvenanceEntry> | undefined,
): number[] | undefined {
  if (!tags) return undefined;
  const weights = new Array(text.length).fill(0);
  let any = false;
  for (const entry of Object.values(tags)) {
    if (entry.type === "none" || !entry.spans) continue;
    for (const span of entry.spans) {
      const idx = text.indexOf(span);
      if (idx === -1) continue; // lives in the other field (title vs body), or doesn't apply here
      any = true;
      for (let i = idx; i < idx + span.length; i++) weights[i]++;
    }
  }
  return any ? weights : undefined;
}

// Collapses a per-character weight array into contiguous same-level runs.
export function buildRuns(
  length: number,
  weights: number[],
): { start: number; end: number; weight: number }[] {
  const runs: { start: number; end: number; weight: number }[] = [];
  let i = 0;
  while (i < length) {
    const w = weights[i] ?? 0;
    let j = i + 1;
    while (j < length && (weights[j] ?? 0) === w) j++;
    runs.push({ start: i, end: j, weight: w });
    i = j;
  }
  return runs;
}

// Body starts at normal weight/size and has room to move — both step up.
// Kindle-highlight-subtle: a nudge, not a shout. Capped at 3 tags deep.
export function bodyWeightStyle(level: number): React.CSSProperties {
  const l = Math.min(level, 3);
  return [
    {},
    { fontWeight: 600, fontSize: "1.03em" },
    { fontWeight: 700, fontSize: "1.06em" },
    { fontWeight: 800, fontSize: "1.09em" },
  ][l];
}

// Title is already bold (700) and already big — the marked portion only
// goes blacker/heavier from here, no further size change, so it reads as
// one continuous gradient of intensity rather than a second, different kind
// of emphasis competing with the first. Capped at 2.
//
// Deliberately never animated (see aliveScaleFor below) — the title staying
// completely still is what makes the body's motion read as a different,
// more alive register, rather than the same trick playing twice.
export function titleWeightStyle(level: number): React.CSSProperties {
  const l = Math.min(level, 2);
  return [{}, { fontWeight: 800 }, { fontWeight: 900 }][l];
}

// ── Alive motion — shared by the live body text (AliveWeightedText, DOM/
// framer-motion) and the share-image video export (SaveImageButton, canvas),
// so both draw from the same amplitude/color vocabulary rather than two
// hand-tuned approximations of "moving."
//
// seededPhase is a deterministic 0..1 hash keyed off a run's own character
// offset — not Math.random(). Two reasons: a run's phase must survive a
// client re-render without reshuffling (Math.random() would restart the
// drift/pulse from a new position every time), and the canvas export needs
// to reproduce the same per-word phase without sharing any runtime state
// with the DOM component that rendered it.
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
export function seededPhase(seed: number): number {
  return hash01(seed);
}

// The rest/plain text color — weighted runs stay this color always. No
// color pulse: the drift+breathe motion already reads as "alive" on its
// own, a color shift on top of it was redundant, not a second signal.
export const ALIVE_REST_COLOR = "#0a0a0a";

export interface AliveScale {
  driftAmpX: number;
  driftAmpY: number;
  scaleAmp:  number;
}

// Amplitude envelope for a given weight level — pure function of the
// level, no randomness. Position/timing variance comes from seededPhase
// applied on top of this by each caller.
export function aliveScaleFor(level: number): AliveScale {
  const l = Math.min(level, 3);
  return {
    driftAmpX: 1   + l * 1.1,  // px
    driftAmpY: 0.8 + l * 0.8,  // px
    scaleAmp:  0.012 + l * 0.009, // fraction — e.g. level 3 breathes up to ~1.04x
  };
}

// A plain, non-animated styled-runs renderer — for surfaces (/writing) that
// don't scramble text in and just need the static weighted result. Mirrors
// exactly what CryptoScramble does with its own weights/weightStyle props
// once a scramble has resolved, so the two surfaces produce the same DOM
// shape for the same data.
export function WeightedText({
  text,
  weights,
  weightStyle,
  style,
  className,
}: {
  text: string;
  weights: number[] | undefined;
  weightStyle: (level: number) => React.CSSProperties | undefined;
  style?: React.CSSProperties;
  className?: string;
}) {
  if (!weights) return <span className={className} style={style}>{text}</span>;
  const runs = buildRuns(text.length, weights);
  return (
    <span className={className} style={style}>
      {runs.map((r, i) => (
        <span key={i} style={r.weight > 0 ? weightStyle(r.weight) : undefined}>
          {text.slice(r.start, r.end)}
        </span>
      ))}
    </span>
  );
}
