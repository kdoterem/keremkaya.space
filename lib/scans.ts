import fs from "fs";
import path from "path";

// Filesystem-driven, like posts.ts/answers.ts — unlike those, a collection
// isn't hand-typed into a content file; new-scan.js writes the folder and
// meta.json for you (resize, aspect ratios, cover thumb, all of it), so
// adding a collection never means touching this file or any TypeScript.
// Server-only (uses fs) — the SCANS page is a client component, so it
// reaches this through app/api/scans, same as posts/answers do through
// their own API routes.

export interface ScanPage {
  src: string;
  // Natural aspect ratio (width / height), so the spread and magnified view
  // can size each page before its image has loaded — avoids layout jumping.
  ratio: number;
}

export interface ScanCollection {
  slug:  string;
  title: string;
  date:  string; // ISO date, for sorting — newest first
  cover: string;
  pages: ScanPage[];
}

interface ScanMeta {
  title: string;
  date:  string;
  cover?: string;
  pages: { file: string; ratio: number }[];
}

const SCANS_DIR = path.join(process.cwd(), "public", "scans");

export function getAllScanCollections(): ScanCollection[] {
  if (!fs.existsSync(SCANS_DIR)) return [];

  const collections = fs
    .readdirSync(SCANS_DIR)
    .filter((slug) => fs.statSync(path.join(SCANS_DIR, slug)).isDirectory())
    .map((slug): ScanCollection | null => {
      const metaPath = path.join(SCANS_DIR, slug, "meta.json");
      if (!fs.existsSync(metaPath)) return null;

      const meta: ScanMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const coverFile = meta.cover ?? meta.pages[0]?.file;

      return {
        slug,
        title: meta.title,
        date:  meta.date,
        cover: `/scans/${slug}/${coverFile}`,
        pages: meta.pages.map((p) => ({ src: `/scans/${slug}/${p.file}`, ratio: p.ratio })),
      };
    })
    .filter((c): c is ScanCollection => c !== null && c.pages.length > 0);

  return collections.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
}
