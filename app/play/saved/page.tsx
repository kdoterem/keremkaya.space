"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PiecePopup from "@/app/components/PiecePopup";
import PlaySaveImageButton from "@/app/components/PlaySaveImageButton";
import { getCategoriesForSlug } from "@/lib/playCategories";
import { getPassage } from "@/lib/playPassages";

// ── Every PLAY writing you've ever finished — merged from the tiered
// flow's history (kk-play-history-v1) and the free-browse mode's
// per-(poem,tag) saves (kk-play-attempts-v1:<slug>:<tag>).
//
// Each entry is a bordered card (real edges — this used to read as
// loose stacked paragraphs, no more distinct than the write screen
// itself) showing a category label and a short preview, not the full
// text — clicking opens it in a popup instead of navigating away. Label
// is the poem's real categories (lib/playCategories.ts), the same
// taxonomy the write screen and tier overview already show, not the
// poem's title or the one tag a browse-mode entry happened to be
// approached through — a poem can touch more than that one tag. Falls
// back to the poem's own title only for the entries with no real
// category at all, so nothing ever shows a blank header.
//
// The popup shows what a saved writing was answering, not just what got
// written. Browse-mode saves already have this baked in — PlayScreen's
// own composedText interleaves each provenance line with what got
// written after it, so `text` there is already self-contained. Tiered-
// flow saves never carried the passage at all (kk-play-history-v1 only
// ever stored the reader's own text) — the popup pulls it back in via
// getPassage(slug), shown above the writing in the same quiet
// italic/muted register the old "your writing" popup used for it.
const ATTEMPTS_PREFIX = "kk-play-attempts-v1:";
const HISTORY_KEY = "kk-play-history-v1";
const PREVIEW_MAX = 160;

interface SavedEntry {
  key:         string;
  slug:        string;
  text:        string;
  savedAt:     string;
  browseHref?: string; // only browse-mode entries have a real screen to return to
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function preview(text: string): string {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX).trimEnd()}…` : flat;
}

export default function SavedWritingsPage() {
  const [entries, setEntries] = useState<SavedEntry[]>([]);
  const [titles, setTitles]   = useState<Record<string, string>>({});
  const [loaded, setLoaded]   = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    const flat: SavedEntry[] = [];
    try {
      const rawHistory = localStorage.getItem(HISTORY_KEY);
      if (rawHistory) {
        const history = JSON.parse(rawHistory) as { slug: string; text: string; completedAt: string }[];
        for (const h of history) {
          flat.push({ key: `tier:${h.slug}:${h.completedAt}`, slug: h.slug, text: h.text, savedAt: h.completedAt });
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
            slug, text: a.text, savedAt: a.savedAt,
            browseHref: `/play/browse/${encodeURIComponent(tag)}/${slug}`,
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

  function labelFor(slug: string): string {
    const categories = getCategoriesForSlug(slug);
    return categories.length > 0
      ? categories.map((c) => c.title).join(" · ")
      : (titles[slug] ?? slug);
  }

  const openEntry = entries.find((e) => e.key === openKey) ?? null;

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

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {entries.map((e) => (
            <button
              key={e.key}
              onClick={() => setOpenKey(e.key)}
              style={{
                display: "block",
                textAlign: "left",
                width: "100%",
                background: "none",
                border: "1px solid rgba(10,10,10,0.3)",
                padding: "1.25rem 1.5rem",
                cursor: "pointer",
                fontFamily: "inherit",
                color: "#0a0a0a",
              }}
            >
              <p style={{ fontSize: "0.95rem", fontWeight: 700, letterSpacing: "-0.01em", marginBottom: "0.3rem" }}>
                {labelFor(e.slug)}
              </p>
              <p style={{ fontSize: "0.68rem", color: "rgba(10,10,10,0.4)", marginBottom: "0.6rem" }}>
                {fmtDateTime(e.savedAt)}
              </p>
              <p style={{ fontSize: "0.85rem", lineHeight: 1.6, color: "rgba(10,10,10,0.65)" }}>
                {preview(e.text)}
              </p>
            </button>
          ))}
        </div>
      </div>

      {openEntry && (
        <PiecePopup label={labelFor(openEntry.slug)} onClose={() => setOpenKey(null)}>
          {/* Tier-flow saves never carried the passage — browse-mode
              saves already have it interleaved into their own text, so
              only pull it in separately for the ones missing it. */}
          {!openEntry.browseHref && (() => {
            const passage = getPassage(openEntry.slug);
            return passage ? (
              <p style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", fontStyle: "italic", color: "rgba(10,10,10,0.55)", marginBottom: "1rem" }}>
                {passage.lines.join("\n")}
              </p>
            ) : null;
          })()}
          <p style={{ whiteSpace: "pre-wrap" }}>{openEntry.text}</p>
          <div style={{ marginTop: "2rem", display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <PlaySaveImageButton category={labelFor(openEntry.slug)} text={openEntry.text} />
            {openEntry.browseHref && (
              <Link
                href={openEntry.browseHref}
                style={{ fontSize: "0.8rem", fontStyle: "italic", color: "rgba(10,10,10,0.55)", textDecoration: "underline", textUnderlineOffset: "3px" }}
              >
                open this passage →
              </Link>
            )}
          </div>
        </PiecePopup>
      )}
    </main>
  );
}
