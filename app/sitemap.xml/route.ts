import { getAllPosts } from "@/lib/posts";

const SITE_URL = "https://keremkaya.space";

const STATIC_PAGES = [
  { url: "/",         priority: "1.0", changefreq: "weekly"  },
  { url: "/writing",  priority: "0.9", changefreq: "weekly"  },
  { url: "/art",      priority: "0.8", changefreq: "monthly" },
  { url: "/answers",  priority: "0.7", changefreq: "monthly" },
  { url: "/find-me",  priority: "0.6", changefreq: "yearly"  },
];

export async function GET() {
  const posts = getAllPosts();

  const staticEntries = STATIC_PAGES.map(({ url, priority, changefreq }) => `
  <url>
    <loc>${SITE_URL}${url}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`).join("");

  const postEntries = posts.map((post) => {
    const lastmod = post.date ? new Date(post.date).toISOString().split("T")[0] : "";
    return `
  <url>
    <loc>${SITE_URL}/writing/${post.slug}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}
    <changefreq>never</changefreq>
    <priority>0.5</priority>
  </url>`;
  }).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntries}
${postEntries}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
