"use client";

import { useState, useCallback, useLayoutEffect, useEffect } from "react";
import { tierForCompletedCount, hasFinishedGame } from "@/lib/playDifficulty";

// Same SSR/first-paint reasoning as useReadingPreference.ts: localStorage
// only exists client-side, so a layout effect corrects a returning
// reader's real progress in before the browser ever paints the empty
// default, rather than flashing tier 1 / zero completions first.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const STORAGE_KEY = "kk-play-progress-v2";
// v2: added `current` — the passage actively being written, if any. v1
// only ever tracked completions, so navigating away from /play (to
// /play/saved, say) and back fully remounted PlayNext with nothing to
// resume — it re-rolled a brand-new random passage every time, silently
// abandoning whatever was mid-draft (the draft text itself wasn't lost,
// just orphaned under a slug nothing pointed at anymore). Bumped rather
// than migrated: a stale v1 value has no `current` field, which is
// exactly equivalent to null here, so falling through to "pick a fresh
// passage" is the correct behavior for it anyway.

interface StoredProgress {
  completed: string[];       // slugs, in the order completed
  current: string | null;    // the passage currently being written, if any
}

const DEFAULT_PROGRESS: StoredProgress = { completed: [], current: null };

export interface PlayProgress {
  completed: string[];
  completedSet: Set<string>;
  current: string | null;
  tier: number;
  finishedGame: boolean;
  hydrated: boolean;
  markCompleted: (slug: string) => void;
  setCurrent: (slug: string | null) => void;
}

export function usePlayProgress(): PlayProgress {
  const [progress, setProgress] = useState<StoredProgress>(DEFAULT_PROGRESS);
  const [hydrated, setHydrated] = useState(false);

  useIsomorphicLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setProgress({ current: null, ...JSON.parse(raw) });
    } catch {
      // Private browsing / storage disabled — stays at zero completions,
      // which just means tier 1 every visit. Not worth surfacing.
    }
    setHydrated(true);
  }, []);

  const persist = useCallback((next: StoredProgress) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Still holds in state for this page view even if it can't persist.
    }
  }, []);

  const markCompleted = useCallback((slug: string) => {
    setProgress((prev) => {
      if (prev.completed.includes(slug)) return prev; // already counted once
      const next = { ...prev, completed: [...prev.completed, slug] };
      persist(next);
      return next;
    });
  }, [persist]);

  const setCurrent = useCallback((slug: string | null) => {
    setProgress((prev) => {
      if (prev.current === slug) return prev;
      const next = { ...prev, current: slug };
      persist(next);
      return next;
    });
  }, [persist]);

  return {
    completed: progress.completed,
    completedSet: new Set(progress.completed),
    current: progress.current,
    tier: tierForCompletedCount(progress.completed.length),
    finishedGame: hasFinishedGame(progress.completed.length),
    hydrated,
    markCompleted,
    setCurrent,
  };
}
