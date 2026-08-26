"use client";

import { useState, useEffect, useCallback } from "react";

// ── Reading preference — localStorage-backed, no accounts on this site so
// this is the only place a choice like this can live. "unset" is the real
// first-visit state (nothing chosen yet, show the onboarding prompt);
// "normal" and "paced" are both explicit choices someone made.
//
// Starts as { mode: "unset" } on every render, including the very first
// server-rendered paint — localStorage only exists client-side, so reading
// it happens in an effect, after mount. This means the onboarding modal
// never flashes into a server-rendered page (avoiding a hydration
// mismatch) and a first-time visitor's very first paint is always the
// plain, safe default reading experience for a brief moment before their
// stored preference (or the prompt, if there isn't one yet) appears.
// v2: switched from a raw words-per-minute number to a pace multiplier
// (see PACE_OPTIONS, app/components/InvisibleInkText.tsx) when the reveal
// itself moved from word-by-word to line-by-line — a different enough
// shape that a stale v1-shaped value (a lone `wpm`) shouldn't silently
// half-apply. Bumping the key just means anyone who chose a preference
// under v1 sees the prompt again once, which is the right outcome here.
const STORAGE_KEY = "kk-reading-preference-v2";

export type ReadingMode = "unset" | "normal" | "paced";

export interface ReadingPreference {
  mode: ReadingMode;
  multiplier?: number; // only meaningful when mode === "paced"
}

const DEFAULT_PREFERENCE: ReadingPreference = { mode: "unset" };

export function useReadingPreference(): [ReadingPreference, (next: ReadingPreference) => void] {
  const [pref, setPref] = useState<ReadingPreference>(DEFAULT_PREFERENCE);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPref(JSON.parse(raw));
    } catch {
      // Private browsing / storage disabled — just stay on the default
      // (unset), which means the prompt shows every visit. Not worth
      // surfacing an error for.
    }
  }, []);

  const save = useCallback((next: ReadingPreference) => {
    setPref(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage failed to persist — the choice still applies for this
      // page view via state, it just won't survive a reload.
    }
  }, []);

  return [pref, save];
}
