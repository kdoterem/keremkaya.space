import { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/posts";

const BASE = "https://keremkaya.space";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE,            lastModified: new Date(), changeFrequency: "weekly",  priority: 1.0 },
    { url: `${BASE}/writing`,  lastModified: new Date(), changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/art`,      lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/find-me`,  lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
  ];

  const postRoutes: MetadataRoute.Sitemap = posts.map((post) => ({
    url:             `${BASE}/writing/${post.slug}`,
    lastModified:    post.date ? new Date(post.date) : new Date(),
    changeFrequency: "monthly",
    priority:        0.8,
  }));

  return [...staticRoutes, ...postRoutes];
}
