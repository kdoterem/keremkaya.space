import { NextResponse } from "next/server";
import { getTagCounts } from "@/lib/posts";

export function GET() {
  const tags = getTagCounts();
  return NextResponse.json(tags);
}
