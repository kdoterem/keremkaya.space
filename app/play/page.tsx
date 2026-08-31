import Link from "next/link";
import { PLAY_CATEGORIES, getPlayableTagsInCategory } from "@/lib/playData";

// ── PLAY — pick a tag, get shown only what that tag actually marks in one
// piece (everything else stays glittered), write your own continuation,
// then compare against the real thing. Not a replacement for reading
// normally — that's still the default everywhere else on the site — this
// is the deep-end version, for whoever wants it.
export default function PlayIndexPage() {
  const categories = PLAY_CATEGORIES
    .map((c) => ({ category: c, tags: getPlayableTagsInCategory(c) }))
    .filter((c) => c.tags.length > 0);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Link
          href="/"
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
        <Link
          href="/play/saved"
          style={{
            fontSize: "0.7rem",
            fontWeight: 500,
            letterSpacing: "0.1em",
            fontVariant: "small-caps",
            color: "#0a0a0a",
            textDecoration: "none",
            opacity: 0.5,
          }}
        >
          your saved writings →
        </Link>
      </div>

      <div style={{ maxWidth: "680px", margin: "0 auto", marginTop: "2.5rem" }}>
        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 3.5rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "1rem",
          }}
        >
          PLAY
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            lineHeight: 1.6,
            color: "rgba(10,10,10,0.55)",
            maxWidth: "42em",
            marginBottom: "3.5rem",
          }}
        >
          pick a direction below, then a specific thing it named — you'll see only
          what that thought marks in one piece, everything else kept illegible. write
          your own continuation before you look at mine. not a quiz — just two people
          who happened to land on the same thought, checking each other's work.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "2.75rem" }}>
          {categories.map(({ category, tags }) => (
            <section key={category.key}>
              <h2
                style={{
                  fontSize: "1.4rem",
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  marginBottom: "0.2rem",
                }}
              >
                {category.title}
              </h2>
              <p
                style={{
                  fontSize: "0.85rem",
                  fontStyle: "italic",
                  color: "rgba(10,10,10,0.45)",
                  marginBottom: "0.9rem",
                }}
              >
                {category.blurb}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                {tags.map(({ tag, count }) => (
                  <Link
                    key={tag}
                    href={`/play/${encodeURIComponent(tag)}`}
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      padding: "0.4rem 0.85rem",
                      border: "1px solid rgba(10,10,10,0.2)",
                      borderRadius: "999px",
                      textDecoration: "none",
                      color: "#0a0a0a",
                    }}
                  >
                    {tag} <span style={{ opacity: 0.4 }}>· {count}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
