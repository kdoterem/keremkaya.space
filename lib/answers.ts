import fs from "fs";
import path from "path";
import matter from "gray-matter";

export interface AnswerMeta {
  slug:     string;
  question: string;
  answer:   string;
  date:     string;
  tags:     string[];
}

const ANSWERS_DIR = path.join(process.cwd(), "content", "answers");

export function getAllAnswers(): AnswerMeta[] {
  if (!fs.existsSync(ANSWERS_DIR)) return [];

  const files = fs.readdirSync(ANSWERS_DIR).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));

  return files
    .map((filename) => {
      const slug = filename.replace(/\.mdx?$/, "");
      const raw = fs.readFileSync(path.join(ANSWERS_DIR, filename), "utf-8");
      const { data } = matter(raw);
      const rawDate = data.date;
      const date = rawDate instanceof Date
        ? rawDate.toISOString().slice(0, 10)
        : rawDate ? String(rawDate).slice(0, 10) : "";

      return {
        slug,
        question: data.question ?? slug,
        answer:   data.answer   ?? "",
        date,
        tags:     Array.isArray(data.tags) ? data.tags : [],
      };
    })
    .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
}

export function getAnswerBySlug(slug: string): AnswerMeta | null {
  for (const ext of [".mdx", ".md"]) {
    const filePath = path.join(ANSWERS_DIR, slug + ext);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const { data } = matter(raw);
      const rawDate = data.date;
      const date = rawDate instanceof Date
        ? rawDate.toISOString().slice(0, 10)
        : rawDate ? String(rawDate).slice(0, 10) : "";

      return {
        slug,
        question: data.question ?? slug,
        answer:   data.answer   ?? "",
        date,
        tags:     Array.isArray(data.tags) ? data.tags : [],
      };
    }
  }
  return null;
}
