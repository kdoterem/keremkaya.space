import { getProvenanceTags } from "./tagProvenance";

// ── PLAY's taxonomy — six categories, grounded in a real co-occurrence/lift
// pass over the archive's tags (which tags actually attract each other in
// practice) rather than an imposed framework. Titles are deliberately
// short and evocative, not clinical labels — the whole point of the
// category screen is "choosing a direction," not filling out a form.
// See tag-provenance.json's commit history for the analysis this came
// from. `family` and `love` were the two tags that never settled cleanly
// into one category (each splits toward two different ones depending on
// the piece) — left out of every category rather than forced into one;
// they simply aren't playable doorways yet.
//
// Split out of lib/playData.ts specifically so this stays fs-free and
// client-importable (same reasoning as lib/tagProvenance.tsx) — playData.ts
// pulls in getAllPosts (fs), so anything that needs it can't be imported
// from a client component like PlayNext.tsx. This file only ever touches
// tagProvenance.tsx, which is deliberately hook-free/fs-free itself.
export interface PlayCategory {
  key:   string;
  title: string;
  blurb: string;
  tags:  string[];
}

export const PLAY_CATEGORIES: PlayCategory[] = [
  {
    key:   "wide-awake",
    title: "wide awake",
    blurb: "what's left when it's clear.",
    tags: [
      "clarity", "existence", "presence", "wonder", "self-acceptance",
      "truth", "consciousness", "self-erosion", "healing", "impermanence",
      "devotion", "acceptance", "sensual",
    ],
  },
  {
    key:   "unsure-hand",
    title: "unsure hand",
    blurb: "talking to myself to find out.",
    tags: ["doubt", "the writing self", "identity", "wordplay", "creative block"],
  },
  {
    key:   "complicated-prayer",
    title: "complicated prayer",
    blurb: "faith held with clenched teeth.",
    tags: ["god", "faith", "mortality", "blasphemy", "defiance", "contempt", "guilt"],
  },
  {
    key:   "long-grind",
    title: "long grind",
    blurb: "worn down, still moving.",
    tags: [
      "sadness", "self-loathing", "exhaustion", "conflict", "grief",
      "endurance", "numbness", "work",
    ],
  },
  {
    key:   "the-ache-toward",
    title: "the ache toward",
    blurb: "reaching for something already gone.",
    tags: ["longing", "yearning", "letting go"],
  },
  {
    key:   "the-body-wants",
    title: "the body wants",
    blurb: "plain, bodily wanting.",
    tags: ["desire", "body", "release", "bravado"],
  },
];

export function findCategoryForTag(tag: string): PlayCategory | undefined {
  return PLAY_CATEGORIES.find((c) => c.tags.includes(tag));
}

const tagToCategory = new Map<string, PlayCategory>(
  PLAY_CATEGORIES.flatMap((c) => c.tags.map((t) => [t, c] as const)),
);

// Every category a poem's real (non-"none") provenance spans actually
// touch, in PLAY_CATEGORIES' own order (not alphabetical, not by
// count) — used to show a quiet "what this is circling" header on the
// tiered PLAY screen. A poem can legitimately touch none (66 of 269 real
// passages have no provenance entry at all, another 3 have provenance
// but nothing that maps to a category) — callers get an empty array
// back, not a placeholder; the passage-selection brief's "none" over
// forced applies here too.
export function getCategoriesForSlug(slug: string): PlayCategory[] {
  const tags = getProvenanceTags(slug);
  if (!tags) return [];
  const found = new Set<PlayCategory>();
  for (const [tag, entry] of Object.entries(tags)) {
    if (entry.type === "none") continue; // no real span — not a real doorway
    const category = tagToCategory.get(tag);
    if (category) found.add(category);
  }
  return PLAY_CATEGORIES.filter((c) => found.has(c));
}
