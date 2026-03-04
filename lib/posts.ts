import fs from "fs";
import path from "path";
import matter from "gray-matter";

export interface PostMeta {
  slug: string;
  title: string;
  date: string;
  tags: string[];
  excerpt?: string;
}

export interface Post extends PostMeta {
  content: string;
}

const POSTS_DIR = path.join(process.cwd(), "content", "posts");

export function getAllPosts(): PostMeta[] {
  if (!fs.existsSync(POSTS_DIR)) return [];

  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));

  const posts = files.map((filename) => {
    const slug = filename.replace(/\.mdx?$/, "");
    const filePath = path.join(POSTS_DIR, filename);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data } = matter(raw);

    const rawDate = data.date;
    const date = rawDate instanceof Date
      ? rawDate.toISOString().slice(0, 10)
      : rawDate ? String(rawDate).slice(0, 10) : "";

    return {
      slug,
      title: data.title ?? slug,
      date,
      tags: data.tags ?? [],
      excerpt: data.excerpt ?? "",
    };
  });

  return posts.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
  });
}

export function getPostBySlug(slug: string): Post | null {
  const tryExts = [".mdx", ".md"];
  for (const ext of tryExts) {
    const filePath = path.join(POSTS_DIR, slug + ext);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const { data, content } = matter(raw);
      const rawDate = data.date;
      const date = rawDate instanceof Date
        ? rawDate.toISOString().slice(0, 10)
        : rawDate ? String(rawDate).slice(0, 10) : "";

      return {
        slug,
        title: data.title ?? slug,
        date,
        tags: data.tags ?? [],
        excerpt: data.excerpt ?? "",
        content,
      };
    }
  }
  return null;
}

export function getAllTags(): string[] {
  const posts = getAllPosts();
  const tagSet = new Set<string>();
  for (const post of posts) {
    for (const tag of post.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}
