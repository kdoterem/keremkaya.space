import { notFound } from "next/navigation";
import Link from "next/link";
import { findGateway } from "@/lib/playGateways";
import { PLAY_CATEGORIES, getPlayableTagsInCategory } from "@/lib/playData";

export default async function PlayGatewayCategoriesPage({
  params,
}: {
  params: Promise<{ gateway: string }>;
}) {
  const { gateway: gatewayKey } = await params;
  const gateway = findGateway(gatewayKey);
  if (!gateway) notFound();

  const categories = PLAY_CATEGORIES
    .map((c) => ({ category: c, tags: getPlayableTagsInCategory(c, gateway.mode) }))
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
        RETURN
      </Link>

      <div style={{ maxWidth: "680px", margin: "0 auto", marginTop: "2.5rem" }}>
        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 3.5rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "0.5rem",
          }}
        >
          {gateway.title}
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            fontStyle: "italic",
            color: "rgba(10,10,10,0.5)",
            marginBottom: "3rem",
          }}
        >
          {gateway.blurb}
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
                    href={`/play/${gateway.key}/${encodeURIComponent(tag)}`}
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
