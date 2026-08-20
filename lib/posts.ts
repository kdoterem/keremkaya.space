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

// ── per-poem text signals — the basis for the terrain's line-drawn texture.
// Nothing here is a summary/aggregate number standing in for the writing;
// these are properties of the actual poem text, read directly. lineLens in
// particular is not a scalar at all — it's the poem's own line-by-line word
// counts, in order, kept as a sequence so the terrain can literally resample
// it as a waveform instead of standing in a noise function for it. ──
export interface PoemTextProfile {
  words: number;
  lineLens: number[];   // word count per non-empty line, in the poem's own order
  punctDensity: number; // sentence-ending/pausing punctuation per word (.?;: plus half-weighted em/en dashes)
  capsRatio: number;    // fraction of words that are ALL-CAPS (2+ letters)
  repetition: number;   // 1 - (unique words / total words), within this one poem
}

function extractTextStats(content: string): PoemTextProfile {
  const words = content.trim().split(/\s+/).filter(Boolean);
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const lineLens = lines.map((l) => l.split(/\s+/).filter(Boolean).length);

  const punctMatches =
    (content.match(/[.?;:]/g) || []).length +
    (content.match(/[—-]/g) || []).length * 0.5;
  const punctDensity = words.length ? punctMatches / words.length : 0;

  const capsWords = words.filter((w) => /^[A-Z]{2,}$/.test(w.replace(/[^A-Za-z]/g, "")));
  const capsRatio = words.length ? capsWords.length / words.length : 0;

  const lower = words.map((w) => w.toLowerCase().replace(/[^a-z']/g, "")).filter(Boolean);
  const uniqueCount = new Set(lower).size;
  const repetition = lower.length ? 1 - uniqueCount / lower.length : 0;

  return { words: words.length, lineLens, punctDensity, capsRatio, repetition };
}

export interface MonthlyTextProfile {
  month: string; // YYYY-MM
  count: number;
  words: number;
  poems: PoemTextProfile[]; // chronological within the month, zero-length for empty months
}

// Same zero-filled month series as getMonthlyProfile, but each month carries
// its actual poems' text profiles instead of just the two summary numbers.
export function getMonthlyTextProfile(): MonthlyTextProfile[] {
  if (!fs.existsSync(POSTS_DIR)) return [];

  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));

  const monthly = new Map<string, { date: string; slug: string; profile: PoemTextProfile }[]>();

  for (const filename of files) {
    const filePath = path.join(POSTS_DIR, filename);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);

    const rawDate = data.date;
    const rawStr = rawDate instanceof Date ? rawDate.toISOString() : rawDate ? String(rawDate) : "";
    if (!rawStr) continue;
    const month = rawStr.slice(0, 7);
    const slug = filename.replace(/\.mdx?$/, "");

    const entry = monthly.get(month) ?? [];
    entry.push({ date: rawStr, slug, profile: extractTextStats(content) });
    monthly.set(month, entry);
  }

  const months = Array.from(monthly.keys()).sort();
  if (months.length === 0) return [];

  const [startY, startM] = months[0].split("-").map(Number);
  const [endY, endM] = months[months.length - 1].split("-").map(Number);

  const series: MonthlyTextProfile[] = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const entries = (monthly.get(month) ?? [])
      .sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
    const poems = entries.map((e) => e.profile);
    const words = poems.reduce((a, p) => a + p.words, 0);
    series.push({ month, count: poems.length, words, poems });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return series;
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
