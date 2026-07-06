import { NextResponse } from "next/server";
import { getSearchIndex } from "@/lib/posts";

export const dynamic = "force-dynamic";

export function GET() {
  const docs = getSearchIndex();
  return NextResponse.json(docs);
}
