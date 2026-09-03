"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ── Every PLAY writing you've ever finished, in one place — merged from
// the two doorways PLAY now has:
//  - the tiered flow's history (kk-play-history-v1, one flat array —
//    see PlayNext.tsx), one entry per completed passage, no gateway/tag
//    to look up since a tier passage isn't scoped to either.
//  - the free-browse mode's per-(poem,tag) saves
//    (kk-play-attempts-v1:<slug>:<tag> — see PlayScreen.tsx), read the
//    same way this page always has, just without the old gateway lookup
//    (the mode split is gone; browse links are unscoped now).
// Poem titles come from /api/posts rather than storing them redundantly
// in every saved entry.
const ATTEMPTS_PREFIX = "kk-play-attempts-v1:";
const HISTORY_KEY = "kk-play-history-v1";

interface SavedEntry {
  key:     string;   // stable React key
  slug:    string;
  tag?:    string;    // present only for browse-mode saves
  text:    string;
  savedAt: string;
  href:    string;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function SavedWritingsPage() {
  const [entries, setEntries] = useState<SavedEntry[]>([]);
  const [titles, setTitles]   = useState<Record<string, string>>({});
  const [loaded, setLoaded]   = useState(false);

  useEffect(() => {
    const flat: SavedEntry[] = [];
    try {
      const rawHistory = localStorage.getItem(HISTORY_KEY);
      if (rawHistory) {
        const history = JSON.parse(rawHistory) as { slug: string; text: string; completedAt: string }[];
        for (const h of history) {
          flat.push({
            key: `tier:${h.slug}:${h.completedAt}`,
            slug: h.slug,
            text: h.text,
            savedAt: h.completedAt,
            href: "/play", // a tier passage isn't individually revisitable — back to the flow itself
          });
        }
      }

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(ATTEMPTS_PREFIX)) continue;
        const rest = key.slice(ATTEMPTS_PREFIX.length); // "<slug>:<tag>"
        const sep = rest.indexOf(":");
        if (sep === -1) continue;
        const slug = rest.slice(0, sep);
        const tag  = rest.slice(sep + 1);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const list = JSON.parse(raw) as { id: string; text: string; savedAt: string }[];
        for (const a of list) {
          flat.push({
            key: `browse:${slug}:${tag}:${a.id}`,
            slug, tag, text: a.text, savedAt: a.savedAt,
            href: `/play/browse/${encodeURIComponent(tag)}/${slug}`,
          });
        }
      }
    } catch {
      // Private browsing / storage disabled — just show nothing saved.
    }
    flat.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)); // newest first
    setEntries(flat);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (entries.length === 0) return;
    fetch("/api/posts")
      .then((r) => r.json())
      .then((posts: { slug: string; title: string }[]) => {
        const map: Record<string, string> = {};
        for (const p of posts) map[p.slug] = p.title;
        setTitles(map);
      })
      .catch(() => {});
  }, [entries]);

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#aaff00",
        color: "#0a0a0a",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        padding: "4rem 5vw 6rem",
      }}
    >
      <Link
        href="/play"
        style={{
          fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.15em",
          fontVariant: "small-caps", color: "#0a0a0a", textDecoration: "none", opacity: 0.5,
        }}
      >
        RETURN
      </Link>

      <div style={{ maxWidth: "640px", margin: "0 auto", marginTop: "3.5rem" }}>
        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "2.5rem" }}>
          your saved writings
        </h1>

        {loaded && entries.length === 0 && (
          <p style={{ fontSize: "0.9rem", color: "rgba(10,10,10,0.5)" }}>
            nothing saved yet — anything you finish in PLAY shows up here.
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          {entries.map((e) => (
            <div key={e.key}>
              <Link
                href={e.href}
                style={{
                  display: "block", fontSize: "0.65rem", fontWeight: 500,
                  letterSpacing: "0.1em", fontVariant: "small-caps",
                  color: "rgba(10,10,10,0.5)", textDecoration: "none", marginBottom: "0.3rem",
                }}
              >
                {titles[e.slug] ?? e.slug}{e.tag ? ` · ${e.tag}` : ""}
              </Link>
              <p style={{ fontSize: "0.7rem", color: "rgba(10,10,10,0.4)", marginBottom: "0.5rem" }}>
                {fmtDateTime(e.savedAt)}
              </p>
              <p style={{ whiteSpace: "pre-wrap", fontSize: "0.95rem", lineHeight: 1.7 }}>
                {e.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
