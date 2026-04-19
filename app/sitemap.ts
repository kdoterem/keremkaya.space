import { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/posts";
import { getAllAnswers } from "@/lib/answers";
import { getAllBooks } from "@/lib/books";

const BASE = "https://keremkaya.space";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts   = getAllPosts();
  const answers = getAllAnswers();

  const books = getAllBooks();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE,               lastModified: new Date(), changeFrequency: "weekly",  priority: 1.0 },
    { url: `${BASE}/writing`,  lastModified: new Date(), changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/books`,    lastModified: new Date(), changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/answers`,  lastModified: new Date(), changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/art`,      lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/find-me`,  lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    ...books.map((b) => ({
      url: `${BASE}/books/${b.id}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.85,
    })),
  ];

  const postRoutes: MetadataRoute.Sitemap = posts.map((post) => ({
    url:             `${BASE}/writing/${post.slug}`,
    lastModified:    post.date ? new Date(post.date) : new Date(),
    changeFrequency: "monthly",
    priority:        0.8,
  }));

  const answerRoutes: MetadataRoute.Sitemap = answers.map((a) => ({
    url:             `${BASE}/answers/${a.slug}`,
    lastModified:    a.date ? new Date(a.date) : new Date(),
    changeFrequency: "monthly",
    priority:        0.8,
  }));

  return [...staticRoutes, ...postRoutes, ...answerRoutes];
}
