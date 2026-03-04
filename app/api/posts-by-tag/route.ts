import { NextResponse } from "next/server";
import { getAllPosts } from "@/lib/posts";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tag = searchParams.get("tag");

  const posts = getAllPosts();
  if (!tag) return NextResponse.json(posts);

  const filtered = posts.filter((p) => p.tags.includes(tag));
  return NextResponse.json(filtered);
}
