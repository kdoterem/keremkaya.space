import { NextResponse } from "next/server";
import tagProvenanceData from "@/tag-provenance.json";

// ── Flat {slug, tag, mode} list for every real-span provenance entry —
// lets /play/saved (a client component; can't import fs-backed data
// directly) work out which gateway a saved writing belongs to, since a
// (slug, tag) pair only ever has one mode and so only ever lives under
// one gateway.
export function GET() {
  const out: { slug: string; tag: string; mode: string }[] = [];
  for (const post of tagProvenanceData as unknown as { slug: string; tags: Record<string, { mode?: string }> }[]) {
    for (const [tag, entry] of Object.entries(post.tags)) {
      if (!entry.mode) continue;
      out.push({ slug: post.slug, tag, mode: entry.mode });
    }
  }
  return NextResponse.json(out);
}
