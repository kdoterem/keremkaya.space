import { getPostBySlug, getAllPosts } from "@/lib/posts";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkBreaks from "remark-breaks";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SaveImageButton from "@/app/components/SaveImageButton";
import ReadingExperience from "@/app/components/ReadingExperience";
// WitnessButton (the unlabeled confetti/"thank you for witnessing" button)
// is shelved, not deleted — the component still lives in
// app/components/WitnessButton.tsx, just not mounted anywhere right now.
import {
  hasProvenance,
  getProvenanceTags,
  computeWeights,
  titleWeightStyle,
  WeightedText,
} from "@/lib/tagProvenance";

// Transforms <p>line1<br>line2</p> → <div class="poem-stanza"><div>line1</div>…</div>
// Real block elements (div) copy as \n on every browser; <span style="display:block"> does not
// on iOS Safari and some desktop browsers because they use tag name, not computed style.
function rehypeBlockLines() {
  return (tree: any) => {
    function walk(node: any) {
      if (!node.children) return;
      node.children = node.children.map((child: any) => {
        if (child.type === 'element' && child.tagName === 'p') {
          const hasBr = child.children?.some(
            (c: any) => c.type === 'element' && c.tagName === 'br'
          );
          if (!hasBr) { walk(child); return child; }

          const lines: any[][] = [[]];
          for (const c of child.children) {
            if (c.type === 'element' && c.tagName === 'br') {
              lines.push([]);
            } else {
              lines[lines.length - 1].push(c);
            }
          }

          return {
            ...child,
            tagName: 'div',
            properties: { className: ['poem-stanza'] },
            children: lines
              .filter(l => l.some((n: any) => n.type !== 'text' || n.value.trim()))
              .map(lineChildren => ({
                type: 'element',
                tagName: 'div',
                properties: {},
                children: lineChildren,
              })),
          };
        }
        walk(child);
        return child;
      });
    }
    walk(tree);
  };
}

const SITE_DESCRIPTION = "rider. righter. re-writer.";
const DESCRIPTION_MAX_LEN = 100;

function stripMarkdownLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/\*([\s\S]*?)\*/g, "$1")
    .replace(/`{1,3}([\s\S]*?)`{1,3}/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/^>\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .trim();
}

// Cut to ~maxLen at a word boundary; only append an ellipsis if we actually cut something.
function truncateAtWord(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const cut  = s.slice(0, maxLen);
  const stop = cut.lastIndexOf(" ");
  return (stop > 0 ? cut.slice(0, stop) : cut).trim() + "…";
}

// Fallback description for posts without an excerpt: the first non-empty,
// markdown-stripped line of the poem itself, trimmed to a snippet.
function deriveDescription(content: string): string {
  if (!content) return SITE_DESCRIPTION;

  // Defensive — content from getPostBySlug is already frontmatter-stripped,
  // but guard against a stray leading block just in case.
  let body = content;
  if (body.startsWith("---")) {
    const end = body.indexOf("---", 3);
    if (end !== -1) body = body.slice(end + 3);
  }

  for (const raw of body.split("\n")) {
    const stripped = stripMarkdownLine(raw.trim());
    if (stripped) return truncateAtWord(stripped, DESCRIPTION_MAX_LEN);
  }

  return SITE_DESCRIPTION;
}

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
  const description = post.excerpt || deriveDescription(post.content);
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

  // Prev / next (newest-first, so idx+1 = older = "previous", idx-1 = newer = "next")
  const all  = getAllPosts();
  const idx  = all.findIndex(p => p.slug === slug);
  const prev = idx < all.length - 1 ? all[idx + 1] : null;
  const next = idx > 0              ? all[idx - 1] : null;

  // Tag provenance — same data, same weighting functions as /terrain
  // (lib/tagProvenance.tsx), so the two surfaces render identical emphasis
  // for identical posts by construction. Posts with no provenance entry
  // (everything before the boundary date) fall through to the untouched
  // MDXRemote path below, exactly as before this feature existed.
  //
  // body.trim() matches getSearchIndex()'s body (what /terrain reads) — the
  // raw post.content getPostBySlug returns isn't trimmed, and provenance
  // spans were located against the trimmed text, so trimming here keeps the
  // character offsets aligned.
  const bodyText       = post.content.trim();
  const provenanceTags = getProvenanceTags(slug);
  const showProvenance = hasProvenance(slug);
  const titleWeights   = computeWeights(post.title, provenanceTags);
  const bodyWeights    = computeWeights(bodyText, provenanceTags);

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
          {showProvenance ? (
            <WeightedText text={post.title} weights={titleWeights} weightStyle={titleWeightStyle} />
          ) : (
            post.title
          )}
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
          <ReadingExperience
            bodyText={bodyText}
            bodyWeights={bodyWeights}
            showProvenance={showProvenance}
            mdxContent={
              <MDXRemote
                source={post.content}
                options={{ mdxOptions: { remarkPlugins: [remarkBreaks], rehypePlugins: [rehypeBlockLines] } }}
              />
            }
          />
        </div>

        {/* Save as image */}
        <SaveImageButton title={post.title} content={post.content} date={post.date} slug={slug} tags={post.tags} />

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
