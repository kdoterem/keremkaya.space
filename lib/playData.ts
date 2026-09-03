import { getAllPosts } from "./posts";
import { playableSlugsForTag, playableTagCounts } from "./tagProvenance";
import type { PlayCategory } from "./playCategories";
export { PLAY_CATEGORIES, findCategoryForTag, getCategoriesForSlug } from "./playCategories";
export type { PlayCategory } from "./playCategories";

// ── The category taxonomy itself (PLAY_CATEGORIES/findCategoryForTag/
// getCategoriesForSlug) now lives in lib/playCategories.ts, fs-free and
// client-importable — this file keeps only what actually needs
// getAllPosts (fs), so importing from here stays server-only. Re-exported
// above so existing consumers (app/play/browse/*) don't need to change
// their import path.

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
