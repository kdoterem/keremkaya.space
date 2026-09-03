import Link from "next/link";
import { PLAY_CATEGORIES, getPlayableTagsInCategory } from "@/lib/playData";

// ── The old gateway→category→tag→poem tree, minus the gateway. That
// up-front "push back" vs "paint a picture" choice is gone from the
// primary flow (see PlayNext.tsx) — this page is now a bonus, reachable
// only once a reader has cleared tier 4 in the tiered flow (PlayNext
// only links here once progress.finishedGame is true; not hard-gated at
// the URL itself — this is a UX reward, not access control, on a
// personal site with nothing behind it worth actually locking).
//
// Categories/tags are no longer scoped to one mode — getPlayableTagsInCategory
// already supports an undefined mode meaning "either," so calling it with
// no argument merges what used to be two separate gateway pools into one.
// Whatever wrote a given piece's provenance as "argue" vs "outpour" still
// exists in the data; it's just not asked of the reader anymore.
export default function PlayBrowsePage() {
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
          href="/play"
          style={{
            fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.15em",
            fontVariant: "small-caps", color: "#0a0a0a", textDecoration: "none", opacity: 0.5,
          }}
        >
          ← PLAY
        </Link>
        <Link
          href="/play/saved"
          style={{
            fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.1em",
            fontVariant: "small-caps", color: "#0a0a0a", textDecoration: "none", opacity: 0.5,
          }}
        >
          your saved writings →
        </Link>
      </div>

      <div style={{ maxWidth: "680px", margin: "0 auto", marginTop: "2.5rem" }}>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.5rem" }}>
          browse freely
        </h1>
        <p style={{ fontSize: "0.95rem", fontStyle: "italic", color: "rgba(10,10,10,0.5)", marginBottom: "3rem" }}>
          the whole archive, by what it's carrying — pick a thread and see where it goes.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "2.75rem" }}>
          {categories.map(({ category, tags }) => (
            <section key={category.key}>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.01em", marginBottom: "0.2rem" }}>
                {category.title}
              </h2>
              <p style={{ fontSize: "0.85rem", fontStyle: "italic", color: "rgba(10,10,10,0.45)", marginBottom: "0.9rem" }}>
                {category.blurb}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                {tags.map(({ tag, count }) => (
                  <Link
                    key={tag}
                    href={`/play/browse/${encodeURIComponent(tag)}`}
                    style={{
                      fontSize: "0.8rem", fontWeight: 500, padding: "0.4rem 0.85rem",
                      border: "1px solid rgba(10,10,10,0.2)", borderRadius: "999px",
                      textDecoration: "none", color: "#0a0a0a",
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
