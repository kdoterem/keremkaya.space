import { notFound } from "next/navigation";
import Link from "next/link";
import { findCategoryForTag, getPlayablePoemsForTag } from "@/lib/playData";
import { stamp } from "@/lib/postStamp";

export default async function PlayBrowseTagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: rawTag } = await params;
  const tag = decodeURIComponent(rawTag);

  const category = findCategoryForTag(tag);
  if (!category) notFound();

  const poems = getPlayablePoemsForTag(tag);
  if (poems.length === 0) notFound();

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#2a0a4a",
        color: "#ffa31a",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        padding: "4rem 5vw 6rem",
      }}
    >
      <Link
        href="/play/browse"
        style={{
          fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.15em",
          fontVariant: "small-caps", color: "#ffa31a", textDecoration: "none", opacity: 0.68,
        }}
      >
        ← BROWSE FREELY
      </Link>

      <div style={{ maxWidth: "640px", margin: "0 auto", marginTop: "3.5rem" }}>
        <p style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.14em", fontVariant: "small-caps", color: "rgba(255,163,26,0.64)", marginBottom: "0.5rem" }}>
          {category.title}
        </p>
        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.75rem" }}>
          {tag}
        </h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(255,163,26,0.68)", marginBottom: "2.5rem" }}>
          pick a piece — only what {tag} marks in it will be legible.
        </p>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {poems.map((poem) => (
            <Link
              key={poem.slug}
              href={`/play/browse/${encodeURIComponent(tag)}/${poem.slug}`}
              style={{
                display: "block", padding: "1rem 0",
                borderBottom: "1px solid rgba(255,163,26,0.5)",
                textDecoration: "none", color: "#ffa31a",
              }}
            >
              <span style={{ fontSize: "1.05rem", fontWeight: 500 }}>{poem.title}</span>
              <span style={{ display: "block", fontSize: "0.75rem", color: "rgba(255,163,26,0.6)", marginTop: "0.2rem" }}>
                {stamp(poem)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
