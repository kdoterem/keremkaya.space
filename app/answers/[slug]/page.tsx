import { getAnswerBySlug, getAllAnswers } from "@/lib/answers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const a = getAnswerBySlug(slug);
  if (!a) return {};

  return {
    title:       a.question,
    description: a.answer,
    openGraph: {
      type:        "article",
      title:       a.question,
      description: a.answer,
      url:         `https://keremkaya.space/answers/${slug}`,
    },
    twitter: {
      card:        "summary",
      title:       a.question,
      description: a.answer,
    },
  };
}

export default async function AnswerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const a = getAnswerBySlug(slug);
  if (!a) notFound();

  const all  = getAllAnswers();
  const idx  = all.findIndex(x => x.slug === slug);
  const prev = idx < all.length - 1 ? all[idx + 1] : null;
  const next = idx > 0              ? all[idx - 1] : null;

  return (
    <main
      style={{
        minHeight:       "100vh",
        backgroundColor: "#aaff00",
        color:           "#0a0a0a",
        fontFamily:      '"Helvetica Neue", Helvetica, Arial, sans-serif',
        padding:         "4rem 5vw 6rem",
      }}
    >
      <Link
        href="/answers"
        style={{
          fontSize:       "0.7rem",
          fontWeight:     500,
          letterSpacing:  "0.15em",
          fontVariant:    "small-caps",
          color:          "#0a0a0a",
          textDecoration: "none",
          opacity:        0.5,
        }}
      >
        ← ANSWERS
      </Link>

      <div style={{ maxWidth: "640px", margin: "0 auto", marginTop: "3.5rem" }}>

        {/* Tags */}
        {a.tags.length > 0 && (
          <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
            {a.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize:      "0.65rem",
                  letterSpacing: "0.1em",
                  fontWeight:    500,
                  fontVariant:   "small-caps",
                  color:         "rgba(10,10,10,0.4)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Question */}
        <h1
          style={{
            fontSize:      "clamp(1.6rem, 4vw, 2.6rem)",
            fontWeight:    700,
            letterSpacing: "-0.02em",
            lineHeight:    1.15,
            marginBottom:  "2.5rem",
            color:         "#0a0a0a",
          }}
        >
          {a.question}
        </h1>

        {/* Answer */}
        <p
          style={{
            fontSize:   "clamp(1.1rem, 2.5vw, 1.4rem)",
            lineHeight: 1.6,
            fontWeight: 400,
            color:      "#0a0a0a",
          }}
        >
          {a.answer}
        </p>

        {/* Date */}
        <p
          style={{
            fontSize:      "0.7rem",
            color:         "rgba(10,10,10,0.35)",
            letterSpacing: "0.05em",
            marginTop:     "2.5rem",
          }}
        >
          {a.date}
        </p>

        {/* Prev / Next */}
        {(prev || next) && (
          <div
            style={{
              display:        "flex",
              justifyContent: "space-between",
              alignItems:     "flex-start",
              marginTop:      "4rem",
              paddingTop:     "2rem",
              borderTop:      "1px solid rgba(10,10,10,0.12)",
              gap:            "2rem",
            }}
          >
            {prev ? (
              <Link href={`/answers/${prev.slug}`} style={{ textDecoration: "none", flex: 1 }}>
                <span style={{ display: "block", fontSize: "0.6rem", letterSpacing: "0.14em", fontVariant: "small-caps", color: "rgba(10,10,10,0.38)", marginBottom: "0.35rem" }}>
                  ← previous
                </span>
                <span style={{ fontSize: "0.88rem", fontWeight: 500, color: "#0a0a0a" }}>
                  {prev.question}
                </span>
              </Link>
            ) : <div style={{ flex: 1 }} />}

            {next ? (
              <Link href={`/answers/${next.slug}`} style={{ textDecoration: "none", flex: 1, textAlign: "right" }}>
                <span style={{ display: "block", fontSize: "0.6rem", letterSpacing: "0.14em", fontVariant: "small-caps", color: "rgba(10,10,10,0.38)", marginBottom: "0.35rem" }}>
                  next →
                </span>
                <span style={{ fontSize: "0.88rem", fontWeight: 500, color: "#0a0a0a" }}>
                  {next.question}
                </span>
              </Link>
            ) : <div style={{ flex: 1 }} />}
          </div>
        )}
      </div>
    </main>
  );
}
