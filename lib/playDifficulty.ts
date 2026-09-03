import difficultyData from "@/play-passage-difficulty.json";

// ── Difficulty data for PLAY's tiered flow — one entry per real passage
// (the 61 null-passage poems from play-passages.json never appear here,
// same "absent, not blank" rule as lib/playPassages.ts). Derived once by
// the difficulty-scoring pass (see play-difficulty-report.md for the full
// methodology); this module just serves it and holds the small constants
// the reader-facing flow needs (tier word floors, unlock thresholds) so
// they live next to the data they're tuned against instead of scattered
// across components.

export interface DifficultyComponents {
  words: number;
  lines: number;
  amount_given_difficulty: number;
  openness: "obvious" | "some" | "quiet";
  concreteness: "concrete" | "mixed" | "abstract";
  gapped: boolean;
}

export interface DifficultyEntry {
  slug: string;
  difficulty_score: number;
  tier: 1 | 2 | 3 | 4;
  components: DifficultyComponents;
}

const bySlug = new Map<string, DifficultyEntry>(
  (difficultyData as DifficultyEntry[]).map((d) => [d.slug, d]),
);

export function getDifficulty(slug: string): DifficultyEntry | undefined {
  return bySlug.get(slug);
}

export function getTier(slug: string): number | undefined {
  return bySlug.get(slug)?.tier;
}

// Every slug in a given tier, in no particular order.
export function getSlugsForTier(tier: number): string[] {
  return (difficultyData as DifficultyEntry[])
    .filter((d) => d.tier === tier)
    .map((d) => d.slug);
}

export const TIER_COUNT = 4;

// Word floor a submission must clear before it's even eligible for the
// fake-eval ceremony — no ceiling (agreed deliberately: "they should write
// as long as they wish"). Tiers 1-2 give the reader more material to work
// from (higher amount_given), so they're asked for more back; tiers 3-4
// already demand more invention just to get any words down, so the floor
// drops. Two bands, not four separate numbers — the tier boundaries
// themselves came from a mostly-continuous score distribution, so a
// finer-grained floor would be false precision.
export function wordFloorForTier(tier: number): number {
  return tier <= 2 ? 15 : 8;
}

// Total passages completed before each tier unlocks. A proposed default,
// not derived from usage data (none exists yet) — tune once real
// completion/retention numbers exist. Tier 1 is always open.
export const TIER_UNLOCK_THRESHOLDS: Record<number, number> = {
  1: 0,
  2: 12,
  3: 35,
  4: 70,
};

// The highest tier a reader with `completedCount` finished passages has
// earned access to — walks the thresholds from the top down so a reader
// past every threshold lands on the last (hardest) tier rather than
// falling through.
export function tierForCompletedCount(completedCount: number): number {
  let tier = 1;
  for (let t = TIER_COUNT; t >= 1; t--) {
    if (completedCount >= TIER_UNLOCK_THRESHOLDS[t]) {
      tier = t;
      break;
    }
  }
  return tier;
}

// A reader has "finished the game" once they've cleared tier 4's own
// unlock threshold from within tier 4 itself, not just reached it — i.e.
// completed at least the threshold's-worth of passages while tier 4 was
// their active tier. Approximated here as: completed enough total
// passages to be sitting in tier 4 AND has completed at least a full
// tier-4-sized taste of it. Kept simple and generous on purpose — this
// gates a bonus (free browse), not a real state that has to be exact.
const TIER_4_TASTE = 15;
export function hasFinishedGame(completedCount: number): boolean {
  return completedCount >= TIER_UNLOCK_THRESHOLDS[4] + TIER_4_TASTE;
}

// 0-1 progress toward the reader's NEXT unlock, for a quiet fill bar
// under the "tier N of 4" label — not a count, on purpose (a number
// there reads like a countdown; a bar just reads as motion). Tiers 1-3
// measure the distance to the next tier's own threshold; tier 4 has no
// next tier to unlock, so it measures toward "finished the game"
// instead (hasFinishedGame's own threshold) — a bar with nowhere to go
// would just look broken.
export function tierProgressFraction(completedCount: number): number {
  const tier = tierForCompletedCount(completedCount);
  const start = TIER_UNLOCK_THRESHOLDS[tier];
  const end = tier < TIER_COUNT ? TIER_UNLOCK_THRESHOLDS[tier + 1] : TIER_UNLOCK_THRESHOLDS[TIER_COUNT] + TIER_4_TASTE;
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (completedCount - start) / (end - start)));
}

// Which passage to serve next: a random uncompleted one from the reader's
// current tier, never repeating whatever they just saw. If that tier is
// exhausted (a very engaged reader), fall back to the nearest tier with
// anything left rather than repeating early — checks the reader's own
// tier first, then works outward. Returns null only once every one of the
// 269 real passages has genuinely been completed.
export function pickNextPassage(
  tier: number,
  completedSlugs: Set<string>,
  excludeSlug?: string,
): string | null {
  const tryTier = (t: number): string | null => {
    const pool = getSlugsForTier(t).filter(
      (s) => !completedSlugs.has(s) && s !== excludeSlug,
    );
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const order = [tier, ...Array.from({ length: TIER_COUNT }, (_, i) => i + 1).filter((t) => t !== tier)];
  for (const t of order) {
    const pick = tryTier(t);
    if (pick) return pick;
  }
  // Every passage completed except possibly the one we're excluding —
  // allow the repeat rather than stall the reader on an empty screen.
  if (excludeSlug && completedSlugs.size < 269) return excludeSlug;
  return null;
}
