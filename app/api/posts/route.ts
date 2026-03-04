import { NextResponse } from "next/server";
import { getAllPosts } from "@/lib/posts";

export const dynamic = "force-dynamic";

export function GET() {
  const posts = getAllPosts();
  return NextResponse.json(posts);
}
