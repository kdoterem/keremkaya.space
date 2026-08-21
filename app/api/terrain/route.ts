import { NextResponse } from "next/server";
import { getMonthlyProfile } from "@/lib/posts";

export function GET() {
  const terrain = getMonthlyProfile();
  return NextResponse.json(terrain);
}
