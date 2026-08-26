"use client";

import { useState, useEffect, useLayoutEffect, useCallback } from "react";

// useLayoutEffect warns if it ever runs during actual server rendering
// ("does nothing on the server") — harmless, but this sidesteps it: on the
// client (the only place this hook's stored-value check needs to run) it's
// a real layout effect; during SSR it quietly falls back to useEffect,
// which never fires server-side anyway.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ── Reading preference — localStorage-backed, no accounts on this site so
// this is the only place a choice like this can live. "unset" is the real
// first-visit state (nothing chosen yet, show the onboarding prompt);
// "normal" and "paced" are both explicit choices someone made.
//
// Starts as { mode: "unset" } on every render, including the very first
// server-rendered paint — localStorage only exists client-side, so reading
// it can only ever happen client-side. That part's unavoidable and fine:
// it's exactly what keeps the server-rendered HTML and the first client
// render matching (no hydration mismatch).
//
// What used to run in a plain useEffect (a returning visitor's real,
// already-chosen preference correcting in) now runs in a layout effect
// instead — the difference is *when* relative to paint. A regular effect
// runs after the browser has already painted the "unset" default, which on
// a client-side navigation between poems (mount → paint "unset" → prompt
// flashes on → effect corrects it → prompt flashes back off) is visible as
// exactly that: a flash. A layout effect runs after the DOM commits but
// before the browser paints, so the correction lands before anything is
// ever shown on screen — a returning visitor's stored choice applies
// silently, with nothing to flash. First-time visitors are unaffected
// either way: there's nothing in storage to correct to, so mode stays
// "unset" and the prompt just appears, same as before.
// v2: switched from a raw words-per-minute number to a pace multiplier
// (see SUGGESTED_MULTIPLIER, app/components/InvisibleInkText.tsx) when the
// reveal itself moved from word-by-word to line-by-line — a different
// enough shape that a stale v1-shaped value (a lone `wpm`) shouldn't
// silently half-apply. Bumping the key just means anyone who chose a
// preference under v1 sees the prompt again once, which is the right
// outcome here. (The shape hasn't changed again since — later versions
// dropped the multiple speed presets down to one suggested pace, but a
// preference is still just { mode, multiplier }, so no v3 was needed.)
const STORAGE_KEY = "kk-reading-preference-v2";

export type ReadingMode = "unset" | "normal" | "paced";

export interface ReadingPreference {
  mode: ReadingMode;
  multiplier?: number; // only meaningful when mode === "paced"
}

const DEFAULT_PREFERENCE: ReadingPreference = { mode: "unset" };

export function useReadingPreference(): [ReadingPreference, (next: ReadingPreference) => void] {
  const [pref, setPref] = useState<ReadingPreference>(DEFAULT_PREFERENCE);

  useIsomorphicLayoutEffect(() => {
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
