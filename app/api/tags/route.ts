import { NextResponse } from "next/server";
import { getAllTags } from "@/lib/posts";

export function GET() {
  const tags = getAllTags();
  return NextResponse.json(tags);
}
