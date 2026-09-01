"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { gatewayForMode } from "@/lib/playGateways";

// ── Every PLAY attempt you've ever saved, in one place. Attempts live
// scattered across one localStorage key per (poem, tag) pair
// (kk-play-attempts-v1:<slug>:<tag>) — fine for the play screen itself,
// which only ever needs its own one doorway's history, but there was no
// way to see everything you'd written across every poem/tag without
// this. Reads every matching key directly; poem titles come from
// /api/posts (already exists, already returns slug+title) rather than
// storing the title redundantly in every saved attempt.
const ATTEMPTS_PREFIX = "kk-play-attempts-v1:";

interface FlatAttempt {
  slug:    string;
  tag:     string;
  id:      string;
  text:    string;
  savedAt: string;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function SavedWritingsPage() {
  const [attempts, setAttempts] = useState<FlatAttempt[]>([]);
  const [titles, setTitles]     = useState<Record<string, string>>({});
  const [modes, setModes]       = useState<Record<string, "outpour" | "argue">>({});
  const [loaded, setLoaded]     = useState(false);

  useEffect(() => {
    const flat: FlatAttempt[] = [];
    try {
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
        for (const a of list) flat.push({ slug, tag, ...a });
      }
    } catch {
      // Private browsing / storage disabled — just show nothing saved.
    }
    flat.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)); // newest first
    setAttempts(flat);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (attempts.length === 0) return;
    fetch("/api/posts")
      .then((r) => r.json())
      .then((posts: { slug: string; title: string }[]) => {
        const map: Record<string, string> = {};
        for (const p of posts) map[p.slug] = p.title;
        setTitles(map);
      })
      .catch(() => {});
    // A (slug, tag) pair only ever has one mode, so only ever belongs to
    // one gateway — needed to link each saved writing back to the right
    // /play/[gateway]/[tag]/[slug] screen.
    fetch("/api/play-modes")
      .then((r) => r.json())
      .then((rows: { slug: string; tag: string; mode: "outpour" | "argue" }[]) => {
        const map: Record<string, "outpour" | "argue"> = {};
        for (const row of rows) map[`${row.slug}|||${row.tag}`] = row.mode;
        setModes(map);
      })
      .catch(() => {});
  }, [attempts]);

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
          fontSize: "0.7rem",
          fontWeight: 500,
          letterSpacing: "0.15em",
          fontVariant: "small-caps",
          color: "#0a0a0a",
          textDecoration: "none",
          opacity: 0.5,
        }}
      >
        RETURN
      </Link>

      <div style={{ maxWidth: "640px", margin: "0 auto", marginTop: "3.5rem" }}>
        <h1
          style={{
            fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "2.5rem",
          }}
        >
          your saved writings
        </h1>

        {loaded && attempts.length === 0 && (
          <p style={{ fontSize: "0.9rem", color: "rgba(10,10,10,0.5)" }}>
            nothing saved yet — anything you save on a PLAY screen shows up here.
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          {attempts.map((a) => {
            const mode = modes[`${a.slug}|||${a.tag}`];
            const gateway = gatewayForMode(mode);
            const href = gateway
              ? `/play/${gateway.key}/${encodeURIComponent(a.tag)}/${a.slug}`
              : "/play";
            return (
            <div key={`${a.slug}:${a.tag}:${a.id}`}>
              <Link
                href={href}
                style={{
                  display: "block",
                  fontSize: "0.65rem",
                  fontWeight: 500,
                  letterSpacing: "0.1em",
                  fontVariant: "small-caps",
                  color: "rgba(10,10,10,0.5)",
                  textDecoration: "none",
                  marginBottom: "0.3rem",
                }}
              >
                {titles[a.slug] ?? a.slug} · {a.tag}
              </Link>
              <p style={{ fontSize: "0.7rem", color: "rgba(10,10,10,0.4)", marginBottom: "0.5rem" }}>
                {fmtDateTime(a.savedAt)}
              </p>
              <p style={{ whiteSpace: "pre-wrap", fontSize: "0.95rem", lineHeight: 1.7 }}>
                {a.text}
              </p>
            </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
