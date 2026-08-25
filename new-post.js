#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const POSTS_DIR = path.join(__dirname, "content", "posts");
const PROVENANCE_PATH = path.join(__dirname, "tag-provenance.json");

// Read one line from the terminal, draining any buffered input first — the
// drain matters whenever a prompt might follow a paste that landed more
// newlines in the tty's buffer than intended (a trailing blank line, a
// second line pasted ahead of the prompt that printed it, etc.). Without
// it, each stray buffered line silently satisfies the NEXT prompt's read
// before the user ever sees it — which is exactly what broke
// promptSpansForTag: pasting a two-line phrase, one line at a time, could
// still leave a stray newline in the buffer that answered "blank" for
// several prompts in a row, skipping straight past the remaining tags to
// the final Save confirmation. promptTags had this drain inline already;
// it just never got pulled into this shared function.
function prompt(label, defaultVal) {
  const hint = defaultVal ? ` (default: ${defaultVal})` : "";
  process.stdout.write(`\n${label}${hint}\n> `);
  const drain = 'while IFS= read -r -t 0.05 _l < /dev/tty 2>/dev/null; do :; done';
  const read  = 'read -r val < /dev/tty; printf "%s" "$val"';
  const r = spawnSync("/bin/sh", ["-c", `${drain}; ${read}`], {
    stdio: ["inherit", "pipe", "inherit"],
  });
  const val = r.stdout ? r.stdout.toString().trim() : "";
  return val || defaultVal || "";
}

function clipboard() {
  const r = spawnSync("pbpaste", [], { encoding: "utf8" });
  if (r.error || !r.stdout.trim()) {
    console.error("\nClipboard is empty — copy your post first, then run newpost.\n");
    process.exit(1);
  }
  return r.stdout.trimEnd();
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

function today() {
  // Full datetime so same-day posts sort by creation time (lib/posts.ts displays only the date portion)
  return new Date().toISOString().replace(/\.\d{3}Z$/, "");
}

// Read all existing tags from post frontmatter, sorted by frequency
function getExistingTags() {
  const freq = {};
  if (!fs.existsSync(POSTS_DIR)) return [];
  for (const f of fs.readdirSync(POSTS_DIR)) {
    if (!f.endsWith(".mdx") && !f.endsWith(".md")) continue;
    // Only read first 512 bytes — tags are always in frontmatter
    const fd = fs.openSync(path.join(POSTS_DIR, f), "r");
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    const raw = buf.toString("utf8", 0, bytesRead);
    const match = raw.match(/^tags:\s*\[([^\]]*)\]/m);
    if (!match) continue;
    const tags = match[1].match(/"([^"]+)"/g) || [];
    for (const t of tags) {
      const tag = t.replace(/"/g, "");
      freq[tag] = (freq[tag] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
}

// Suggest tags by matching content words against existing tags
function suggestTags(content, allTags) {
  const lower = content.toLowerCase();
  return allTags.filter((tag) => {
    // Multi-word tags: check if all words appear in content
    const words = tag.toLowerCase().split(/\s+/);
    return words.every((w) => lower.includes(w));
  });
}

// Multi-select tag picker with suggestions
function promptTags(suggestedTags, allTags) {
  const selected = [...suggestedTags];

  console.log("\n── Tag selection ─────────────────────");
  console.log("Suggested tags (based on content):");
  if (suggestedTags.length) {
    suggestedTags.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
  } else {
    console.log("  (none matched automatically)");
  }
  console.log("\nAll existing tags:");
  const sortedTags = [...allTags].sort((a, b) => a.localeCompare(b));
  const chunks = [];
  for (let i = 0; i < sortedTags.length; i += 6) chunks.push(sortedTags.slice(i, i + 6));
  chunks.forEach((row) => console.log("  " + row.join(", ")));
  console.log("\nType a tag to toggle it on/off (from the list or a new one).");
  console.log("Type 'done' or leave blank when finished. Aim for 3–6 tags, most important first.");

  while (true) {
    const input = prompt(`  [${selected.length ? selected.join(", ") : "none"}]`).toLowerCase();
    if (!input || input === "done") break;

    const idx = selected.findIndex((t) => t.toLowerCase() === input);
    if (idx === -1) {
      selected.push(input);
      console.log(`  + added "${input}"`);
    } else {
      selected.splice(idx, 1);
      console.log(`  - removed "${input}"`);
    }
  }

  return selected;
}

// ── provenance (the "alive" highlight data) ────────────
// You (the author) know what phrase carries a tag better than anyone
// close-reading it after the fact — so this asks at write time instead
// of needing a separate pass later. Every span gets checked against
// what you actually pasted before it's accepted: computeWeights()
// (lib/tagProvenance.tsx) does an exact substring match, so a phrase
// that's off by a comma or a typo would silently do nothing.

// One tag's worth of spans. Blank on the first prompt = "none" — that's
// a real, honest answer here (see tag-provenance.json's existing "none"
// entries), not a failure to fill something in.
function promptSpansForTag(tag, title, body) {
  const spans = [];
  console.log(`\n  "${tag}" — paste the exact phrase/line(s) that carry it (copy from`);
  console.log(`  above, don't retype, so punctuation/spacing match exactly).`);
  console.log(`  Blank line to move to the next tag. Blank on the first = "none".`);
  while (true) {
    const line = prompt(`  [${tag}] phrase ${spans.length + 1}`, "");
    if (!line) break;
    if (!title.includes(line) && !body.includes(line)) {
      console.log(`  ⚠ not found verbatim in the title or body — check spelling/punctuation. Not added.`);
      continue;
    }
    spans.push(line);
    console.log(`  + added`);
  }
  return spans;
}

// { "type": "phrase"/"lines"/"none", "spans"?: [...] } — inline-formatted
// to match tag-provenance.json's existing hand-tuned compact style
// ({ "type": ..., "spans": [...] } on one line), not JSON.stringify's
// default multi-line output, so adding one entry doesn't reformat the
// whole file.
function formatEntryObject(entry) {
  const parts = [`"type": ${JSON.stringify(entry.type)}`];
  if (entry.spans) parts.push(`"spans": [${entry.spans.map((s) => JSON.stringify(s)).join(", ")}]`);
  return `{ ${parts.join(", ")} }`;
}

function formatProvenanceEntry(slug, dateOnly, tagsObj) {
  const tagKeys = Object.keys(tagsObj);
  const maxLen = Math.max(...tagKeys.map((k) => JSON.stringify(k).length));
  const lines = tagKeys.map((tag) => {
    const keyStr = JSON.stringify(tag);
    const pad = " ".repeat(maxLen - keyStr.length);
    return `      ${keyStr}${pad}: ${formatEntryObject(tagsObj[tag])}`;
  });
  return (
    `  {\n` +
    `    "slug": ${JSON.stringify(slug)},\n` +
    `    "date": ${JSON.stringify(dateOnly)},\n` +
    `    "tags": {\n${lines.join(",\n")}\n    }\n` +
    `  }`
  );
}

// Splices the new entry in before the array's closing "]" — string
// surgery on the raw file text, not a parse-and-JSON.stringify
// round-trip, which would blow the whole file's hand-aligned formatting
// out into standard multi-line JSON and turn a one-post diff into a
// file-wide one. Validates the result actually parses before writing;
// leaves the file untouched and prints the entry for manual pasting if
// anything looks off.
function appendProvenanceEntry(entryStr) {
  const raw = fs.readFileSync(PROVENANCE_PATH, "utf-8");
  const trimmed = raw.replace(/\s+$/, "");
  if (!trimmed.endsWith("]")) {
    console.log("\n⚠ tag-provenance.json doesn't end with ']' as expected — not touching it. Add this entry manually:\n");
    console.log(entryStr + "\n");
    return false;
  }
  const withoutBracket = trimmed.slice(0, -1).replace(/\s+$/, "");
  const isEmpty = withoutBracket.trim() === "[";
  const updated = withoutBracket + (isEmpty ? "\n" : ",\n") + entryStr + "\n]\n";

  try {
    JSON.parse(updated);
  } catch (err) {
    console.log("\n⚠ generated entry didn't produce valid JSON — not touching tag-provenance.json. Add this manually:\n");
    console.log(entryStr + "\n");
    console.log("Error:", err.message, "\n");
    return false;
  }

  fs.writeFileSync(PROVENANCE_PATH, updated);
  return true;
}

// ── main ──────────────────────────────────────────────

console.log("\n── New Post ──────────────────────────");
console.log("(Copy your post to clipboard before filling this in)");

const title = prompt("Title");
if (!title) { console.log("\nTitle is required."); process.exit(1); }

const slug    = slugify(title);
const date    = prompt("Date", today());
const excerpt = prompt("Excerpt (one line)");

console.log("\nReading clipboard and existing tags...");
const body    = clipboard();
const allTags = getExistingTags();
const suggested = suggestTags(body + " " + title + " " + excerpt, allTags);

const tags = promptTags(suggested, allTags);

// Optional — the highlight/provenance data. null = skipped entirely,
// {} or all-"none" = attempted but nothing to write (handled the same
// way at save time, so a post with nothing real never gets a dead
// entry — see the save-time check below for why that matters).
let provenanceTags = null;
if (tags.length > 0) {
  const wantProvenance = prompt(
    `Add highlight phrases now? For each tag, paste the exact phrase from\n` +
    `the poem that carries it — those get the "alive" highlight treatment\n` +
    `on /writing and in the share video. Blank = "none" for that tag\n` +
    `(honest and normal — not every tag has to anchor to specific text).`,
    "y"
  );
  if (wantProvenance.toLowerCase() === "y") {
    provenanceTags = {};
    for (const tag of tags) {
      const spans = promptSpansForTag(tag, title, body);
      provenanceTags[tag] = spans.length
        ? { type: spans.length === 1 ? "phrase" : "lines", spans }
        : { type: "none" };
    }
  }
}

const tagsYaml = tags.map((t) => `"${t}"`).join(", ");

console.log("\n──────────────────────────────────────");
console.log(`  title:   ${title}`);
console.log(`  date:    ${date}`);
console.log(`  excerpt: ${excerpt || "(none)"}`);
console.log(`  tags:    ${tags.length ? tags.join(", ") : "(none)"}`);
if (provenanceTags) {
  const withSpans = Object.values(provenanceTags).filter((e) => e.type !== "none").length;
  console.log(`  provenance: ${withSpans}/${tags.length} tags have highlight phrases`);
}
console.log(`  file:    content/posts/${slug}.mdx`);
console.log("──────────────────────────────────────");

const confirm = prompt("Save? (y/n)", "y");
if (confirm.toLowerCase() !== "y") { console.log("\nAborted.\n"); process.exit(0); }

const frontmatter = `---\ntitle: "${title}"\ndate: "${date}"\nexcerpt: "${excerpt}"\ntags: [${tagsYaml}]\n---\n\n`;
const finalContent = frontmatter + body;

const outputPath = path.join(POSTS_DIR, `${slug}.mdx`);
if (fs.existsSync(outputPath)) {
  console.log(`\n"${slug}" already exists. Nothing saved.\n`);
  process.exit(1);
}

fs.writeFileSync(outputPath, finalContent);
console.log(`\nPost saved → content/posts/${slug}.mdx\n`);

// Only write an entry if at least one tag actually got a real span. An
// entry where every tag is "none" wouldn't add any highlighting — but
// hasProvenance(slug) (lib/tagProvenance.tsx) would still flip this post
// onto the plain-pre-wrap weighted-text render path instead of MDXRemote,
// silently dropping markdown formatting for zero benefit. So "attempted
// but nothing real" and "skipped entirely" both fall through to the same
// plain, un-flagged post below.
const hasAnySpans = provenanceTags && Object.values(provenanceTags).some((e) => e.type !== "none");

if (hasAnySpans) {
  const entryStr = formatProvenanceEntry(slug, date.slice(0, 10), provenanceTags);
  if (appendProvenanceEntry(entryStr)) {
    const withSpans = Object.values(provenanceTags).filter((e) => e.type !== "none").length;
    console.log(`Provenance data saved → tag-provenance.json (${withSpans}/${tags.length} tags highlighted)\n`);
  }
} else {
  console.log(
    `This post doesn't have tag-provenance.json data yet, so it'll render\n` +
    `plain (no alive highlighting) until it does.\n\n` +
    `Ask Claude: "do the provenance pass on the pending posts"\n` +
    `(or run \`node check-provenance.js\` any time to see what's pending)\n`
  );
}
