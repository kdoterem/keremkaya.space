import playPassageData from "@/play-passages.json";

// ── PLAY passage data — one hand-picked passage per poem (see the passage
// selection brief), distinct from tag-provenance.json's per-tag spans and
// not derived from them. Same shape/loading pattern as tagProvenance.tsx
// (data-only, fs-free, safe to import from client and server components
// alike) but a flat one-entry-per-poem file rather than one-entry-per-tag.
//
// A poem's entry can have passage: null — the passage-selection brief's
// own escape hatch for a poem that genuinely doesn't have a usable one
// (too short, too self-sealed to cut). That's an honest, expected answer,
// not a gap to paper over: every read path below treats a null passage
// exactly like no entry at all, so a null-passage poem simply never
// surfaces as a PLAY doorway rather than rendering blank or throwing.

export interface Passage {
  lines: string[];
  gapped: boolean;
  // What a chosen passage IS, not an instruction to the reader — the
  // reader picks what to do with it. "both"/"neither" are legitimate,
  // not a forced binary; see matchesPassageType for how each queries.
  type: "claim" | "scene" | "both" | "neither";
  // Working documentation only — why the passage stops where it does, or
  // why an obvious-looking stretch was rejected. Never render this in
  // the UI; it's for whoever's curating this data, not the reader.
  note?: string;
}

export interface PassageEntry {
  slug: string;
  date: string;
  passage: Passage | null;
  // Only meaningful (and only present) alongside passage: null — the
  // reason no passage was chosen. Same "internal only" rule as
  // Passage.note above.
  note?: string;
}

const passageBySlug = new Map<string, PassageEntry>(
  (playPassageData as PassageEntry[]).map((p) => [p.slug, p]),
);

// The real, playable passage for a slug — undefined for both "no entry
// yet" and "entry exists but passage is null", deliberately conflated so
// every caller gets the null-handling above for free instead of having
// to remember to check both cases itself.
export function getPassage(slug: string): Passage | undefined {
  return passageBySlug.get(slug)?.passage ?? undefined;
}

export function hasPlayablePassage(slug: string): boolean {
  return !!passageBySlug.get(slug)?.passage;
}

// Every slug with a real (non-null) passage, in data order — the current
// full doorway pool for PLAY's passage mode, once it's wired to a route.
export function playablePassageSlugs(): string[] {
  return (playPassageData as PassageEntry[])
    .filter((p) => p.passage !== null)
    .map((p) => p.slug);
}

export type PassageTypeQuery = "claim" | "scene";

// "both" satisfies either specific query; "neither" satisfies neither
// (a neither-typed passage still exists and is still playable — it just
// never comes up when someone's filtered to claim-only or scene-only).
export function matchesPassageType(type: Passage["type"], query: PassageTypeQuery): boolean {
  return type === query || type === "both";
}

export function getPassagesForType(query: PassageTypeQuery): PassageEntry[] {
  return (playPassageData as PassageEntry[]).filter(
    (p) => p.passage !== null && matchesPassageType(p.passage.type, query),
  );
}

// Sized the same way playableTagCounts sizes tags — lets a future
// category/mode screen show real counts without loading post bodies.
export function passageTypeCounts(): Record<Passage["type"], number> {
  const counts: Record<Passage["type"], number> = { claim: 0, scene: 0, both: 0, neither: 0 };
  for (const p of playPassageData as PassageEntry[]) {
    if (p.passage) counts[p.passage.type]++;
  }
  return counts;
}
