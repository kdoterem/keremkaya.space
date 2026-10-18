import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllScanCollections } from "@/lib/scans";
import ScansClient from "../ScansClient";

// The shareable link for one collection — same SCANS page, opened straight
// into it. The cover doubles as the link-preview image.

export const dynamic = "force-dynamic";

function getCollection(slug: string) {
  return getAllScanCollections().find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = getCollection(slug);
  if (!c) return {};

  const description = `${c.pages.length} scanned page${c.pages.length === 1 ? "" : "s"}`;
  return {
    title:       c.title,
    description,
    openGraph: {
      type:   "website",
      title:  c.title,
      description,
      url:    `https://keremkaya.space/scans/${slug}`,
      images: [{ url: c.cover }],
    },
    twitter: {
      card:   "summary_large_image",
      title:  c.title,
      description,
      images: [c.cover],
    },
  };
}

export default async function ScanCollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getCollection(slug)) notFound();
  return <ScansClient initialSlug={slug} />;
}
