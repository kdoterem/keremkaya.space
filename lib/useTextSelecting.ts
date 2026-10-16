"use client";

import { useSyncExternalStore } from "react";

// True while the reader has text selected anywhere on the page. iOS Safari
// drops its copy bar (and can lose the handles) whenever the content under
// a selection moves, so the alive text holds still while this is true.
// One shared selectionchange listener, however many components ask.
const listeners = new Set<() => void>();
let selecting = false;

function check() {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  const now = !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
  if (now !== selecting) {
    selecting = now;
    listeners.forEach((l) => l());
  }
}

function subscribe(l: () => void) {
  if (listeners.size === 0) document.addEventListener("selectionchange", check);
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) document.removeEventListener("selectionchange", check);
  };
}

export function useTextSelecting(): boolean {
  return useSyncExternalStore(subscribe, () => selecting, () => false);
}
