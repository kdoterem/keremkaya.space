import { getPostBySlug, getAllPosts } from "@/lib/posts";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkBreaks from "remark-breaks";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SaveImageButton from "@/app/components/SaveImageButton";
import BookBar from "@/app/components/BookBar";
import { getBookForPoem, getPrevNextInBook } from "@/lib/books";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  const title       = post.title;
  const description = post.excerpt || "An essay on Believable Belief.";
  const url         = `https://keremkaya.space/writing/${slug}`;

  return {
    title,
    description,
    openGraph: {
      type:        "article",
      title,
      description,
      url,
      publishedTime: post.date,
      tags:          post.tags,
    },
    twitter: {
      card:        "summary",
      title,
      description,
    },
  };
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  // Prev / next — book-aware if the poem belongs to a book
  const bookResult = getBookForPoem(slug);
  let prev: { slug: string; title: string } | null = null;
  let next: { slug: string; title: string } | null = null;

  if (bookResult) {
    const { prev: prevSlug, next: nextSlug } = getPrevNextInBook(bookResult.book, slug);
    if (prevSlug) { const p = getPostBySlug(prevSlug); if (p) prev = { slug: prevSlug, title: p.title }; }
    if (nextSlug) { const n = getPostBySlug(nextSlug); if (n) next = { slug: nextSlug, title: n.title }; }
  } else {
    // Chronological fallback for poems not in any book
    const all = getAllPosts();
    const idx = all.findIndex(p => p.slug === slug);
    const older = idx < all.length - 1 ? all[idx + 1] : null;
    const newer = idx > 0              ? all[idx - 1] : null;
    if (older) prev = { slug: older.slug, title: older.title };
    if (newer) next = { slug: newer.slug, title: newer.title };
  }

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
      {/* Book bar */}
      <BookBar slug={slug} />

      {/* Back to writing */}
      <Link
        href="/writing"
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
        ← WRITING
      </Link>

      <div
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          marginTop: "3.5rem",
        }}
      >
        {/* Tags */}
        {post.tags.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: "0.6rem",
              marginBottom: "1rem",
              flexWrap: "wrap",
            }}
          >
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/?tag=${encodeURIComponent(tag)}`}
                className="tag-link"
                style={{
                  fontSize:       "0.65rem",
                  letterSpacing:  "0.1em",
                  fontWeight:     500,
                  fontVariant:    "small-caps",
                  textDecoration: "none",
                }}
              >
                {tag}
              </Link>
            ))}
          </div>
        )}

        {/* Title */}
        <h1
          style={{
            fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            marginBottom: "0.5rem",
            color: "#0a0a0a",
          }}
        >
          {post.title}
        </h1>

        {/* Date */}
        <p
          style={{
            fontSize: "0.75rem",
            color: "rgba(10,10,10,0.4)",
            letterSpacing: "0.05em",
            marginBottom: "3rem",
          }}
        >
          {post.date}
        </p>

        {/* Content */}
        <div
          style={{
            fontSize: "1.05rem",
            lineHeight: 1.8,
            color: "#0a0a0a",
          }}
          className="prose-content"
        >
          <MDXRemote
            source={post.content}
            options={{ mdxOptions: { remarkPlugins: [remarkBreaks] } }}
          />
        </div>

        {/* Save as image */}
        <SaveImageButton title={post.title} content={post.content} date={post.date} />

        {/* Prev / Next */}
        {(prev || next) && (
          <div
            style={{
              display:       "flex",
              justifyContent: "space-between",
              alignItems:    "flex-start",
              marginTop:     "4rem",
              paddingTop:    "2rem",
              borderTop:     "1px solid rgba(10,10,10,0.12)",
              gap:           "2rem",
            }}
          >
            {/* Previous = older post */}
            {prev ? (
              <Link href={`/writing/${prev.slug}`} style={{ textDecoration: "none", flex: 1 }}>
                <span style={{ display: "block", fontSize: "0.6rem", letterSpacing: "0.14em", fontVariant: "small-caps", color: "rgba(10,10,10,0.38)", marginBottom: "0.35rem" }}>
                  ← previous
                </span>
                <span className="post-nav-title">{prev.title}</span>
              </Link>
            ) : <div style={{ flex: 1 }} />}

            {next ? (
              <Link href={`/writing/${next.slug}`} style={{ textDecoration: "none", flex: 1, textAlign: "right" }}>
                <span style={{ display: "block", fontSize: "0.6rem", letterSpacing: "0.14em", fontVariant: "small-caps", color: "rgba(10,10,10,0.38)", marginBottom: "0.35rem" }}>
                  next →
                </span>
                <span className="post-nav-title">{next.title}</span>
              </Link>
            ) : <div style={{ flex: 1 }} />}
          </div>
        )}
      </div>
    </main>
  );
}
