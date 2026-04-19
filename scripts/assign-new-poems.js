#!/usr/bin/env node
/**
 * assign-new-poems.js
 *
 * Runs at build time. Finds any poem slugs not yet in any book,
 * scores them against each book's keyword list, and assigns them.
 * Unmatched poems go to miscellaneous.
 *
 * Usage: node scripts/assign-new-poems.js
 */

const fs = require("fs");
const path = require("path");

const POSTS_DIR = path.join(__dirname, "../content/posts");
const BOOKS_FILE = path.join(__dirname, "../content/books/index.json");

// --- load data ---
const books = JSON.parse(fs.readFileSync(BOOKS_FILE, "utf-8"));
const postFiles = fs
  .readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith(".mdx") || f.endsWith(".md"))
  .map((f) => f.replace(/\.mdx?$/, ""));

// All slugs currently assigned
const assignedSlugs = new Set(books.flatMap((b) => b.poems));

// Find unassigned
const unassigned = postFiles.filter((slug) => !assignedSlugs.has(slug));

if (unassigned.length === 0) {
  console.log("✓ All poems assigned — nothing to do.");
  process.exit(0);
}

console.log(`Found ${unassigned.length} unassigned poem(s):`);
unassigned.forEach((s) => console.log(`  - ${s}`));

// Score a slug against a book's keywords using tags + title words
function score(slug, bookKeywords) {
  if (bookKeywords.length === 0) return 0; // misc never matches by keyword

  // Read the file to get tags
  let tags = [];
  const tryExts = [".mdx", ".md"];
  for (const ext of tryExts) {
    const fp = path.join(POSTS_DIR, slug + ext);
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, "utf-8");
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const tagsLine = fmMatch[1]
          .split("\n")
          .find((l) => l.startsWith("tags:"));
        if (tagsLine) {
          tags = tagsLine
            .replace(/^tags:\s*\[?/, "")
            .replace(/\]?\s*$/, "")
            .split(",")
            .map((t) => t.trim().replace(/["']/g, "").toLowerCase())
            .filter(Boolean);
        }
      }
      break;
    }
  }

  // Score: +2 per tag match, +1 per title word match
  const titleWords = slug.split("-").map((w) => w.toLowerCase());
  const keywords = bookKeywords.map((k) => k.toLowerCase());

  let s = 0;
  for (const tag of tags) {
    if (keywords.includes(tag)) s += 2;
  }
  for (const word of titleWords) {
    if (keywords.includes(word)) s += 1;
  }
  return s;
}

// Assign each unassigned poem
const miscBook = books.find((b) => b.id === "miscellaneous");
const curatedBooks = books.filter((b) => b.id !== "miscellaneous");

let changed = false;
for (const slug of unassigned) {
  const scores = curatedBooks.map((b) => ({
    book: b,
    score: score(slug, b.keywords),
  }));

  const best = scores.reduce(
    (a, b) => (b.score > a.score ? b : a),
    { book: null, score: 0 }
  );

  if (best.score > 0) {
    best.book.poems.push(slug);
    console.log(`  → "${slug}" assigned to "${best.book.title}" (score ${best.score})`);
  } else {
    miscBook.poems.push(slug);
    console.log(`  → "${slug}" assigned to Miscellaneous (no match)`);
  }
  changed = true;
}

if (changed) {
  fs.writeFileSync(BOOKS_FILE, JSON.stringify(books, null, 2));
  console.log("✓ books/index.json updated.");
}
