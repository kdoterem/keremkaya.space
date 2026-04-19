import { getAllBooks, getBookById } from "@/lib/books";
import { getPostBySlug } from "@/lib/posts";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const book = getBookById(id);
  if (!book) return {};
  return {
    title: book.title,
    description: book.subtitle,
  };
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = getBookById(id);
  if (!book) notFound();

  // Resolve poem metadata for each slug
  const poems = book.poems
    .map((slug) => {
      const post = getPostBySlug(slug);
      return post ? { slug, title: post.title, date: post.date, excerpt: post.excerpt } : null;
    })
    .filter(Boolean) as { slug: string; title: string; date: string; excerpt?: string }[];

  const STATUS_LABEL: Record<string, string> = {
    ongoing: "ongoing",
    complete: "complete",
    new: "new entries",
  };

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
      <div style={{ maxWidth: "720px", margin: "0 auto" }}>
        {/* Back */}
        <Link
          href="/books"
          style={{
            fontSize: "0.65rem",
            fontWeight: 500,
            letterSpacing: "0.15em",
            fontVariant: "small-caps",
            color: "#0a0a0a",
            textDecoration: "none",
            opacity: 0.45,
          }}
        >
          ← BOOKS
        </Link>

        {/* Book header */}
        <div style={{ marginTop: "3.5rem", marginBottom: "3.5rem" }}>
          <div
            style={{
              fontSize: "0.55rem",
              letterSpacing: "0.18em",
              fontWeight: 500,
              opacity: 0.4,
              fontVariant: "small-caps",
              marginBottom: "1rem",
            }}
          >
            {STATUS_LABEL[book.status] ?? book.status} · {poems.length} poems
          </div>

          <h1
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              marginBottom: "1rem",
            }}
          >
            {book.title}
          </h1>

          <p
            style={{
              fontSize: "0.9rem",
              opacity: 0.5,
              lineHeight: 1.5,
              maxWidth: "480px",
            }}
          >
            {book.subtitle}
          </p>
        </div>

        {/* Divider */}
        <div
          style={{
            borderTop: "1px solid rgba(10,10,10,0.12)",
            marginBottom: "2.5rem",
          }}
        />

        {/* Poem list */}
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {poems.map((poem, i) => (
            <li key={poem.slug}>
              <Link
                href={`/writing/${poem.slug}`}
                style={{ textDecoration: "none", display: "block" }}
              >
                <div
                  className="book-poem-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2.5rem 1fr auto",
                    alignItems: "baseline",
                    gap: "0 1.25rem",
                    padding: "1rem 0",
                    borderBottom: "1px solid rgba(10,10,10,0.07)",
                  }}
                >
                  {/* Number */}
                  <span
                    style={{
                      fontSize: "0.65rem",
                      opacity: 0.3,
                      letterSpacing: "0.05em",
                      fontVariant: "small-caps",
                      paddingTop: "0.15rem",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>

                  {/* Title + excerpt */}
                  <div>
                    <span
                      style={{
                        fontSize: "1rem",
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                        color: "#0a0a0a",
                        display: "block",
                        marginBottom: poem.excerpt ? "0.2rem" : 0,
                      }}
                    >
                      {poem.title}
                    </span>
                    {poem.excerpt && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          opacity: 0.4,
                          lineHeight: 1.4,
                          display: "block",
                        }}
                      >
                        {poem.excerpt}
                      </span>
                    )}
                  </div>

                  {/* Date */}
                  <span
                    style={{
                      fontSize: "0.65rem",
                      opacity: 0.3,
                      letterSpacing: "0.04em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {poem.date}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
