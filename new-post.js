#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const POSTS_DIR = path.join(__dirname, "content", "posts");

// Read one line from the terminal, draining any buffered input first
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
  return new Date().toISOString().split("T")[0];
}

// Read all existing tags from post frontmatter, sorted by frequency
function getExistingTags() {
  const freq = {};
  if (!fs.existsSync(POSTS_DIR)) return [];
  for (const f of fs.readdirSync(POSTS_DIR)) {
    if (!f.endsWith(".mdx") && !f.endsWith(".md")) continue;
    const raw = fs.readFileSync(path.join(POSTS_DIR, f), "utf8");
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
  const chunks = [];
  for (let i = 0; i < allTags.length; i += 6) chunks.push(allTags.slice(i, i + 6));
  chunks.forEach((row) => console.log("  " + row.join(", ")));
  console.log("\nType a tag to toggle it on/off (from the list or a new one).");
  console.log("Type 'done' or leave blank when finished. Aim for 3–5 tags, most important first.");

  while (true) {
    process.stdout.write(`\n  [${selected.length ? selected.join(", ") : "none"}]\n> `);
    const drain = 'while IFS= read -r -t 0.05 _l < /dev/tty 2>/dev/null; do :; done';
    const read  = 'read -r val < /dev/tty; printf "%s" "$val"';
    const r = spawnSync("/bin/sh", ["-c", `${drain}; ${read}`], {
      stdio: ["inherit", "pipe", "inherit"],
    });
    const input = (r.stdout ? r.stdout.toString().trim() : "").toLowerCase();
    if (!input || input === "done") break;

    const idx = selected.findIndex((t) => t.toLowerCase() === input);
    if (idx === -1) {
      if (selected.length >= 5) {
        console.log("  (max 5 tags — remove one first)");
      } else {
        selected.push(input);
        console.log(`  + added "${input}"`);
      }
    } else {
      selected.splice(idx, 1);
      console.log(`  - removed "${input}"`);
    }
  }

  return selected;
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

const tagsYaml = tags.map((t) => `"${t}"`).join(", ");

console.log("\n──────────────────────────────────────");
console.log(`  title:   ${title}`);
console.log(`  date:    ${date}`);
console.log(`  excerpt: ${excerpt || "(none)"}`);
console.log(`  tags:    ${tags.length ? tags.join(", ") : "(none)"}`);
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
