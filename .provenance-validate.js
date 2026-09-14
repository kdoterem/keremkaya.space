#!/usr/bin/env node
// Validates a batch of provenance entries (JSON array, same shape as tag-provenance.json)
// against the real post bodies before merging. Usage:
//   node .provenance-validate.js path/to/batch-output.json
//
// Checks:
//  - slug exists in content/posts/
//  - every tag listed was actually one of the tags on that post
//  - every non-"none" entry has spans; every span is a verbatim substring of the post body
//  - flags duplicate slugs already present in tag-provenance.json (so you don't clobber by accident)
const fs = require("fs");
const path = require("path");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node .provenance-validate.js <batch.json>");
  process.exit(1);
}

const ROOT = __dirname;
const postsDir = path.join(ROOT, "content/posts");
const existingPath = path.join(ROOT, "tag-provenance.json");
const existing = JSON.parse(fs.readFileSync(existingPath, "utf8"));
const existingSlugs = new Set(existing.map(e => e.slug));

let batch;
try {
  batch = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (e) {
  console.error("could not parse input as JSON:", e.message);
  process.exit(1);
}
if (!Array.isArray(batch)) {
  console.error("expected a JSON array at the top level.");
  process.exit(1);
}

// load all posts: slug -> { body, tags }
const postFiles = fs.readdirSync(postsDir).filter(f => f.endsWith(".mdx"));
const posts = {};
for (const f of postFiles) {
  const raw = fs.readFileSync(path.join(postsDir, f), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) continue;
  const front = m[1];
  const body = m[2].trim();
  const tagsM = front.match(/^tags:\s*\[([^\]]*)\]/m);
  const tags = tagsM ? tagsM[1].split(",").map(t => t.trim().replace(/^"|"$/g, "")).filter(Boolean) : [];
  const titleM = front.match(/^title:\s*"((?:[^"\\]|\\.)*)"/m);
  const title = titleM ? titleM[1].replace(/\\"/g, "\"") : "";
  // spans can legitimately quote the title (e.g. a tag that only shows up there) as well as the body
  posts[f.replace(/\.mdx$/, "")] = { body, title, searchable: title + "\n" + body, tags };
}

let errors = 0;
let warnings = 0;
let okEntries = 0;
let okSpans = 0;

for (const entry of batch) {
  const { slug, tags } = entry || {};
  if (!slug) { console.log(`✗ entry missing "slug" field:`, JSON.stringify(entry).slice(0, 80)); errors++; continue; }
  const post = posts[slug];
  if (!post) { console.log(`✗ [${slug}] no matching post found in content/posts/`); errors++; continue; }
  if (existingSlugs.has(slug)) { console.log(`⚠ [${slug}] already has an entry in tag-provenance.json — merging will need to replace, not append`); warnings++; }
  if (!tags || typeof tags !== "object") { console.log(`✗ [${slug}] missing "tags" object`); errors++; continue; }

  for (const [tag, info] of Object.entries(tags)) {
    if (!post.tags.includes(tag)) {
      console.log(`✗ [${slug}] tag "${tag}" isn't actually on this post (real tags: ${post.tags.join(", ")})`);
      errors++;
      continue;
    }
    if (!info || typeof info !== "object" || !info.type) {
      console.log(`✗ [${slug}] tag "${tag}" has no "type"`);
      errors++;
      continue;
    }
    if (info.type === "none") { okEntries++; continue; }
    if (!["line", "lines", "phrase"].includes(info.type)) {
      console.log(`⚠ [${slug}] tag "${tag}" has unexpected type "${info.type}"`);
      warnings++;
    }
    if (!Array.isArray(info.spans) || info.spans.length === 0) {
      console.log(`✗ [${slug}] tag "${tag}" (type "${info.type}") has no spans`);
      errors++;
      continue;
    }
    for (const span of info.spans) {
      if (typeof span !== "string" || !post.searchable.includes(span)) {
        console.log(`✗ [${slug}] tag "${tag}" — span NOT found verbatim in post body or title:\n    "${span}"`);
        errors++;
      } else {
        okSpans++;
      }
    }
    okEntries++;
  }
}

console.log(`\n--- ${batch.length} entries checked ---`);
console.log(`ok tags: ${okEntries}, ok spans: ${okSpans}, warnings: ${warnings}, errors: ${errors}`);
process.exit(errors > 0 ? 1 : 0);
