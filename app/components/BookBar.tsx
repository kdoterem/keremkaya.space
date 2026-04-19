import { getBookForPoem } from "@/lib/books";
import Link from "next/link";

interface Props {
  slug: string;
}

const STATUS_LABEL: Record<string, string> = {
  ongoing: "ongoing",
  complete: "complete",
  new: "new",
};

export default function BookBar({ slug }: Props) {
  const result = getBookForPoem(slug);
  if (!result) return null;

  const { book, position } = result;

  return (
    <Link
      href={`/books/${book.id}`}
      style={{ textDecoration: "none", display: "block" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          marginBottom: "2.5rem",
          padding: "0.6rem 0.9rem",
          backgroundColor: "#0a0a0a",
          color: "#aaff00",
        }}
      >
        {/* Book title */}
        <span
          style={{
            fontSize: "0.6rem",
            fontWeight: 600,
            letterSpacing: "0.12em",
            fontVariant: "small-caps",
          }}
        >
          {book.title}
        </span>

        {/* Separator */}
        <span style={{ opacity: 0.3, fontSize: "0.5rem" }}>·</span>

        {/* Position */}
        <span
          style={{
            fontSize: "0.6rem",
            letterSpacing: "0.08em",
            opacity: 0.55,
            fontVariant: "small-caps",
          }}
        >
          {position} of {book.poems.length}
        </span>

        {/* Separator */}
        <span style={{ opacity: 0.3, fontSize: "0.5rem" }}>·</span>

        {/* Status */}
        <span
          style={{
            fontSize: "0.6rem",
            letterSpacing: "0.08em",
            opacity: 0.55,
            fontVariant: "small-caps",
          }}
        >
          {STATUS_LABEL[book.status] ?? book.status}
        </span>
      </div>
    </Link>
  );
}
