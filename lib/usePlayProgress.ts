"use client";

import { useState, useCallback, useLayoutEffect, useEffect } from "react";
import { tierForCompletedCount, hasFinishedGame } from "@/lib/playDifficulty";

// Same SSR/first-paint reasoning as useReadingPreference.ts: localStorage
// only exists client-side, so a layout effect corrects a returning
// reader's real progress in before the browser ever paints the empty
// default, rather than flashing tier 1 / zero completions first.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const STORAGE_KEY = "kk-play-progress-v1";

interface StoredProgress {
  completed: string[]; // slugs, in the order completed
}

const DEFAULT_PROGRESS: StoredProgress = { completed: [] };

export interface PlayProgress {
  completed: string[];
  completedSet: Set<string>;
  tier: number;
  finishedGame: boolean;
  hydrated: boolean;
  markCompleted: (slug: string) => void;
}

export function usePlayProgress(): PlayProgress {
  const [progress, setProgress] = useState<StoredProgress>(DEFAULT_PROGRESS);
  const [hydrated, setHydrated] = useState(false);

  useIsomorphicLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setProgress(JSON.parse(raw));
    } catch {
      // Private browsing / storage disabled — stays at zero completions,
      // which just means tier 1 every visit. Not worth surfacing.
    }
    setHydrated(true);
  }, []);

  const markCompleted = useCallback((slug: string) => {
    setProgress((prev) => {
      if (prev.completed.includes(slug)) return prev; // already counted once
      const next = { completed: [...prev.completed, slug] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Still holds in state for this page view even if it can't persist.
      }
      return next;
    });
  }, []);

  return {
    completed: progress.completed,
    completedSet: new Set(progress.completed),
    tier: tierForCompletedCount(progress.completed.length),
    finishedGame: hasFinishedGame(progress.completed.length),
    hydrated,
    markCompleted,
  };
}
