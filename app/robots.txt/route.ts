export async function GET() {
  const body = `User-agent: *
Allow: /

Sitemap: https://keremkaya.space/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
