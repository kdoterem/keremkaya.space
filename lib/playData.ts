import { getAllPosts } from "./posts";
import { playableSlugsForTag, playableTagCounts } from "./tagProvenance";

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

export interface PlayableTag {
  tag:   string;
  count: number;
}

// A category's tags, sized by how many real doorways each one currently
// has WITHIN one gateway's mode — a tag with plenty of "argue" doorways
// might have none under "outpour", and only shows up where it actually
// has something. mode is optional (matches playableTagCounts below it) —
// /play/browse calls this with no mode at all now that the gateway
// choice is gone from the primary flow, merging what used to be two
// separate pools into one.
export function getPlayableTagsInCategory(
  category: PlayCategory,
  mode?: "outpour" | "argue",
): PlayableTag[] {
  const counts = playableTagCounts(mode);
  return category.tags
    .map((tag) => ({ tag, count: counts.get(tag) ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export interface PlayablePoem {
  slug:  string;
  title: string;
  date:  string;
}

// Every poem playable for a given tag, newest first (matches
// getAllPosts' own ordering) — the pool /play/browse/[tag] lists for
// someone to pick from. mode is optional; /play/browse never passes one.
export function getPlayablePoemsForTag(tag: string, mode?: "outpour" | "argue"): PlayablePoem[] {
  const slugs  = new Set(playableSlugsForTag(tag, mode));
  if (slugs.size === 0) return [];
  return getAllPosts()
    .filter((p) => slugs.has(p.slug))
    .map((p) => ({ slug: p.slug, title: p.title, date: p.date }));
}
