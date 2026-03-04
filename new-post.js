#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs   = require("fs");
const path = require("path");

const POSTS_DIR = path.join(__dirname, "content", "posts");

// ── helpers ───────────────────────────────────────────────────────────────────

function readLine() {
  const drain = 'while IFS= read -r -t 0.05 _l < /dev/tty 2>/dev/null; do :; done';
  const read  = 'read -r val < /dev/tty; printf "%s" "$val"';
  const r = spawnSync("/bin/sh", ["-c", `${drain}; ${read}`], {
    stdio: ["inherit", "pipe", "inherit"],
  });
  return r.stdout ? r.stdout.toString().trim() : "";
}

function prompt(label, defaultVal) {
  const hint = defaultVal ? ` (default: ${defaultVal})` : "";
  process.stdout.write(`\n${label}${hint}\n> `);
  const val = readLine();
  return val || defaultVal || "";
}

// Collect all tags already used across every published post
function readExistingTags() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const set = new Set();
  fs.readdirSync(POSTS_DIR).forEach(file => {
    if (!file.endsWith(".mdx")) return;
    const content = fs.readFileSync(path.join(POSTS_DIR, file), "utf8");
    const m = content.match(/^tags:\s*\[([^\]]*)\]/m);
    if (m) {
      m[1].split(",").forEach(t => {
        const clean = t.trim().replace(/^["']|["']$/g, "");
        if (clean) set.add(clean);
      });
    }
  });
  return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function promptTags(existingTags) {
  const tags = [];

  // Show every tag that exists in the repo for easy reference
  if (existingTags.length > 0) {
    console.log("\nAll existing tags:");
    const cols = 5;
    const colW = Math.max(...existingTags.map(t => t.length)) + 3;
    for (let i = 0; i < existingTags.length; i += cols) {
      console.log(
        "  " +
        existingTags.slice(i, i + cols)
          .map(t => t.padEnd(colW))
          .join("")
          .trimEnd()
      );
    }
  }

  console.log("\nType one tag at a time, Enter to add, same tag again to remove, blank to finish.");

  while (true) {
    process.stdout.write(`\n  current: [${tags.length ? tags.join(", ") : "none"}]\n> `);
    const input = readLine();
    if (!input) break;

    // Show partial matches against existing tags (helpful when you half-remember a tag)
    const matches = existingTags.filter(
      t => t.toLowerCase().includes(input.toLowerCase()) &&
           t.toLowerCase() !== input.toLowerCase()
    );
    if (matches.length > 0 && matches.length <= 10) {
      console.log(`  similar: ${matches.join("  ")}`);
    }

    const idx = tags.findIndex(t => t.toLowerCase() === input.toLowerCase());
    if (idx === -1) {
      tags.push(input);
      console.log(`  + added "${input}"`);
    } else {
      tags.splice(idx, 1);
      console.log(`  - removed "${input}"`);
    }
  }

  return tags;
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

// ── main ──────────────────────────────────────────────────────────────────────

console.log("\n── New Post ──────────────────────────");
console.log("(Copy your post to clipboard before filling this in)");

const title = prompt("Title");
if (!title) { console.log("\nTitle is required."); process.exit(1); }

const slug    = slugify(title);
const date    = prompt("Date", today());
const excerpt = prompt("Excerpt (one line)");
const tags    = promptTags(readExistingTags());

const tagsYaml = tags.map(t => `"${t}"`).join(", ");

console.log("\n──────────────────────────────────────");
console.log(`  title:   ${title}`);
console.log(`  date:    ${date}`);
console.log(`  excerpt: ${excerpt || "(none)"}`);
console.log(`  tags:    ${tags.length ? tags.join(", ") : "(none)"}`);
console.log(`  file:    content/posts/${slug}.mdx`);
console.log("──────────────────────────────────────");

const confirm = prompt("Save? (y/n)", "y");
if (confirm.toLowerCase() !== "y") { console.log("\nAborted.\n"); process.exit(0); }

const body         = clipboard();
const frontmatter  = `---\ntitle: "${title}"\ndate: "${date}"\nexcerpt: "${excerpt}"\ntags: [${tagsYaml}]\n---\n\n`;
const finalContent = frontmatter + body;

const outputPath = path.join(POSTS_DIR, `${slug}.mdx`);
if (fs.existsSync(outputPath)) {
  console.log(`\n"${slug}" already exists. Nothing saved.\n`);
  process.exit(1);
}

fs.writeFileSync(outputPath, finalContent);
console.log(`\nPost saved → content/posts/${slug}.mdx\n`);
