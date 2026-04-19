import { getAllBooks } from "@/lib/books";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Books",
  description: "Poetry collections by Kerem Kaya",
};

const STATUS_LABEL: Record<string, string> = {
  ongoing: "ongoing",
  complete: "complete",
  new: "new",
};

export default function BooksPage() {
  const books = getAllBooks();

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
      {/* Header */}
      <div style={{ maxWidth: "960px", margin: "0 auto" }}>
        <p
          style={{
            fontSize: "0.65rem",
            fontWeight: 500,
            letterSpacing: "0.15em",
            fontVariant: "small-caps",
            opacity: 0.45,
            marginBottom: "3.5rem",
          }}
        >
          BOOKS
        </p>

        {/* Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "1.5px",
          }}
        >
          {books.map((book) => (
            <Link
              key={book.id}
              href={`/books/${book.id}`}
              style={{ textDecoration: "none" }}
            >
              <div
                style={{
                  backgroundColor: "#0a0a0a",
                  padding: "2.5rem 2rem",
                  aspectRatio: "2/3",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  transition: "opacity 0.15s",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.opacity = "0.85";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.opacity = "1";
                }}
              >
                {/* Top: status */}
                <div
                  style={{
                    fontSize: "0.55rem",
                    letterSpacing: "0.18em",
                    fontWeight: 500,
                    color: "rgba(170,255,0,0.45)",
                    fontVariant: "small-caps",
                  }}
                >
                  {STATUS_LABEL[book.status] ?? book.status}
                </div>

                {/* Middle: title */}
                <div>
                  <h2
                    style={{
                      fontSize: "clamp(1.4rem, 2.5vw, 1.9rem)",
                      fontWeight: 700,
                      lineHeight: 1.1,
                      letterSpacing: "-0.02em",
                      color: "#aaff00",
                      marginBottom: "0.75rem",
                    }}
                  >
                    {book.title}
                  </h2>
                  <p
                    style={{
                      fontSize: "0.75rem",
                      lineHeight: 1.5,
                      color: "rgba(170,255,0,0.5)",
                      fontWeight: 400,
                    }}
                  >
                    {book.subtitle}
                  </p>
                </div>

                {/* Bottom: count */}
                <div
                  style={{
                    fontSize: "0.6rem",
                    letterSpacing: "0.1em",
                    color: "rgba(170,255,0,0.3)",
                    fontVariant: "small-caps",
                  }}
                >
                  {book.poems.length} poems
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
