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
    const mtime = fs.statSync(filePath).mtimeMs;

    const rawDate = data.date;
    const rawStr  = rawDate instanceof Date ? rawDate.toISOString() : rawDate ? String(rawDate) : "";
    const date    = rawStr.slice(0, 10);
    const sortKey = rawStr;

    return {
      slug,
      title: data.title ?? slug,
      date,
      tags: data.tags ?? [],
      excerpt: data.excerpt ?? "",
      sortKey,
      mtime,
    };
  });

  return posts
    .sort((a, b) => {
      if (!a.sortKey) return 1;
      if (!b.sortKey) return -1;
      const cmp = b.sortKey < a.sortKey ? -1 : b.sortKey > a.sortKey ? 1 : 0;
      if (cmp !== 0) return cmp;
      return b.mtime - a.mtime;
    })
    .map(({ sortKey: _, mtime: __, ...rest }) => rest);
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

export interface SearchDoc {
  slug: string;
  title: string;
  date: string;
  tags: string[];
  body: string;
}

// Full-text index: metadata + the raw poem body, used for word-match search.
export function getSearchIndex(): SearchDoc[] {
  if (!fs.existsSync(POSTS_DIR)) return [];

  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));

  return files.map((filename) => {
    const slug = filename.replace(/\.mdx?$/, "");
    const filePath = path.join(POSTS_DIR, filename);
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
      body: content.trim(),
    };
  });
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

export interface TagCount {
  tag:   string;
  count: number;
}

// Same tag universe as getAllTags(), paired with how many posts carry each —
// the basis for sizing the homepage tag cloud by frequency instead of chance.
export function getTagCounts(): TagCount[] {
  const posts = getAllPosts();
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export interface MonthlyProfile {
  month: string; // YYYY-MM
  count: number;
  words: number;
}

// One entry per calendar month from the earliest post to the most recent,
// zero-filled so the series has no gaps — the basis for a terrain/timeline view.
export function getMonthlyProfile(): MonthlyProfile[] {
  if (!fs.existsSync(POSTS_DIR)) return [];

  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));

  const monthly = new Map<string, { count: number; words: number }>();

  for (const filename of files) {
    const filePath = path.join(POSTS_DIR, filename);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);

    const rawDate = data.date;
    const rawStr = rawDate instanceof Date ? rawDate.toISOString() : rawDate ? String(rawDate) : "";
    if (!rawStr) continue;
    const month = rawStr.slice(0, 7);

    const words = content.trim().split(/\s+/).filter(Boolean).length;

    const entry = monthly.get(month) ?? { count: 0, words: 0 };
    entry.count += 1;
    entry.words += words;
    monthly.set(month, entry);
  }

  const months = Array.from(monthly.keys()).sort();
  if (months.length === 0) return [];

  const [startY, startM] = months[0].split("-").map(Number);
  const [endY, endM] = months[months.length - 1].split("-").map(Number);

  const series: MonthlyProfile[] = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const entry = monthly.get(month) ?? { count: 0, words: 0 };
    series.push({ month, count: entry.count, words: entry.words });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return series;
}
