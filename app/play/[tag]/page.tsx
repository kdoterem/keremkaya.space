import { notFound } from "next/navigation";
import Link from "next/link";
import { findCategoryForTag, getPlayablePoemsForTag } from "@/lib/playData";

export default async function PlayTagPage({
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
        backgroundColor: "#fff",
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
        ← PLAY
      </Link>

      <div style={{ maxWidth: "640px", margin: "0 auto", marginTop: "3.5rem" }}>
        <p
          style={{
            fontSize: "0.65rem",
            fontWeight: 500,
            letterSpacing: "0.14em",
            fontVariant: "small-caps",
            color: "rgba(10,10,10,0.45)",
            marginBottom: "0.5rem",
          }}
        >
          {category.title}
        </p>
        <h1
          style={{
            fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "0.75rem",
          }}
        >
          {tag}
        </h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(10,10,10,0.5)", marginBottom: "2.5rem" }}>
          pick a piece — only what {tag} marks in it will be legible.
        </p>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {poems.map((poem) => (
            <Link
              key={poem.slug}
              href={`/play/${encodeURIComponent(tag)}/${poem.slug}`}
              style={{
                display: "block",
                padding: "1rem 0",
                borderBottom: "1px solid rgba(10,10,10,0.1)",
                textDecoration: "none",
                color: "#0a0a0a",
              }}
            >
              <span style={{ fontSize: "1.05rem", fontWeight: 500 }}>{poem.title}</span>
              <span
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  color: "rgba(10,10,10,0.4)",
                  marginTop: "0.2rem",
                }}
              >
                {poem.date}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
