import { getAllPosts } from "@/lib/posts";

const SITE_URL = "https://keremkaya.space";

function escape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET() {
  const posts = getAllPosts();

  const items = posts
    .map((post) => {
      const url = `${SITE_URL}/writing/${post.slug}`;
      const pubDate = post.date ? new Date(post.date).toUTCString() : "";
      const excerpt = post.excerpt ? escape(post.excerpt) : "";
      return `
    <item>
      <title>${escape(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      ${excerpt ? `<description>${excerpt}</description>` : ""}
    </item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Believable Belief</title>
    <link>${SITE_URL}</link>
    <description>Writer. Painter. Believer.</description>
    <language>en</language>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
